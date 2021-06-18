const os = require(`os`)
const fs = require('fs/promises')
const { exec } = require(`node-exec-promise`)
const { performance } = require(`perf_hooks`)
const ffprobe = require(`node-ffprobe`)
const bmp = require(`bmp-js`)
const resizeImg = require('resize-img')
const ssim = require(`ssim.js`).default
const ms = require(`ms`)

const stepSizeSmall = 25
const stepSizeMedium = 150
const stepSizeLarge = 1000

let = checkedOffsets = []

async function findNextSceneChange(video, startOffset, endOffset) {

  const direction = startOffset <= endOffset ? 1 : -1
  let currentStepSize = direction * stepSizeLarge

  let framesDir = await fs.mkdtemp(`tmp/frames`)
  
  console.debug(`seekPosition:`, ms(startOffset))
  let seekPosition = startOffset / 1000.0
  let fullOutputPath = `${framesDir}/screenshot_${performance.now()*10000000000000}.bmp`  

  // console.log(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${video}" -vframes 200 -vf cropdetect=24:2:0 -f null - -y`);
  let blackBarResult = await exec(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${video}" -vframes 200 -vf cropdetect=24:2:0 -f null - -y`)
  let cropValue = blackBarResult.stderr.split(`\n`).splice(-4, 1)[0].match(/crop=(\d+\:\d+:\d+:\d+)/)[1]
  console.debug(`cropValue:`, cropValue)
  
  // extract the first frame
  await exec(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${video}" -vf crop=${cropValue} -frames:v 1 "${fullOutputPath}" -y -loglevel error`)
  console.debug(`fullOutputPath:`, fullOutputPath)
  
  let previousFrameData = bmp.decode(await fs.readFile(fullOutputPath), {
    format: `bmp`,
  })
  
  // extract first frame
  let previousFrame = {
    offset: startOffset,
    path: fullOutputPath,
    data: previousFrameData,
  }
  let currentFrame
  let currentFrameOffset = startOffset + currentStepSize
  let currentFrameData
  let previousMaxOffset = currentFrameOffset
  let delta

  while (
    (direction === 1 && currentFrameOffset < endOffset) ||
    (direction === -1 && currentFrameOffset > endOffset)
  ) {
    
    // console.log(`currentFrameOffset:`, currentFrameOffset)
    checkedOffsets.push(currentFrameOffset)
    seekPosition = currentFrameOffset / 1000.0
    fullOutputPath = `${framesDir}/screenshot_${performance.now()*10000000000000}.bmp`  

    // extract the frame
    await exec(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${video}" -vf crop=${cropValue} -frames:v 1 "${fullOutputPath}" -y -loglevel error`)
    // console.log(`fullOutputPath:`, fullOutputPath)
    
    currentFrameData = bmp.decode(await fs.readFile(fullOutputPath), {
      format: `bmp`,
    })

    currentFrame = {
      offset: currentFrameOffset,
      path: fullOutputPath,
      data: currentFrameData,
    }

    delta = 1 - ssim(previousFrame.data, currentFrame.data).mssim;
    console.debug(`delta:`, delta)

    if (delta > 0.5) {
      // scene change detected

      if (currentStepSize === direction * stepSizeSmall) {
        // already in high-accuracy mode

        return {
          preSceneChangeFrame: direction === 1 ? previousFrame : currentFrame,
          postSceneChangeFrame: direction === 1 ? currentFrame : previousFrame,
          delta,
        }

      } else if (currentStepSize === direction * stepSizeMedium) {
        console.debug(`Switching to high-accuracy mode...`);

        // backtrack to preSceneChange frame offset
        // previousFrame is the preSceneChange frame, so in the next iteration previous and current frame will be the same, that's fine
        previousMaxOffset = currentFrameOffset
        currentFrameOffset = previousFrame.offset
        currentStepSize = direction * stepSizeSmall // switch to small step size for increased accuracy
        // fs.unlink(currentFrame.path) // discard old, unneeded frame
        continue // don't increase currentFrameOffset, jump right back to the top
        
      } else {
        console.debug(`Switching to medium-accuracy mode...`);

        // backtrack to preSceneChange frame offset
        // previousFrame is the preSceneChange frame, so in the next iteration previous and current frame will be the same, that's fine
        previousMaxOffset = currentFrameOffset
        currentFrameOffset = previousFrame.offset
        currentStepSize = direction * stepSizeMedium // switch to small step size for increased accuracy
        fs.unlink(currentFrame.path) // discard old, unneeded frame
        continue // don't increase currentFrameOffset, jump right back to the top
        
      }
      
    } else {

      await fs.unlink(previousFrame.path) // discard old, unneeded frame
      previousFrame = currentFrame

      if (
        currentStepSize !== direction * stepSizeLarge &&
        (direction === 1 && (previousMaxOffset <= currentFrameOffset)) ||
        (direction === -1 && (previousMaxOffset >= currentFrameOffset))
      ) {
          // transition detected, switch back to low-accuracy mode
          console.debug(`Transition detected, switching back to low-accuracy mode...`);
          currentStepSize = direction * stepSizeLarge
        }
      
    }

    currentFrameOffset += currentStepSize // go to next frame based on current step size
    
  }

  throw new Error(`No scene change found`)

}

async function searchForMatchingScene(video2, video1SceneChange, startOffset, endOffset) {

  let video2SceneChange = await findNextSceneChange(video2, startOffset, endOffset)

  if (video1SceneChange.preSceneChangeFrame.data.width !== video2SceneChange.preSceneChangeFrame.data.width || video1SceneChange.preSceneChangeFrame.data.height !== video2SceneChange.preSceneChangeFrame.data.height) {
    console.debug(`resizing...`)
    video2SceneChange.preSceneChangeFrame.data = bmp.decode(await resizeImg(await fs.readFile(video2SceneChange.preSceneChangeFrame.path), {
      format: `bmp`,
      width: video1SceneChange.preSceneChangeFrame.data.width,
      height: video1SceneChange.preSceneChangeFrame.data.height,
    }));
    video2SceneChange.postSceneChangeFrame.data = bmp.decode(await resizeImg(await fs.readFile(video2SceneChange.postSceneChangeFrame.path), {
      format: `bmp`,
      width: video1SceneChange.preSceneChangeFrame.data.width,
      height: video1SceneChange.preSceneChangeFrame.data.height,
    }));
  }
  
  let preSceneChangeFrameSimilarity = ssim(video1SceneChange.preSceneChangeFrame.data, video2SceneChange.preSceneChangeFrame.data).mssim
  let postSceneChangeFrameSimilarity = ssim(video1SceneChange.postSceneChangeFrame.data, video2SceneChange.postSceneChangeFrame.data).mssim

  let deltaOfDeltas = Math.abs(video1SceneChange.delta - video2SceneChange.delta)

  return {
    video2SceneChange,
    preSceneChangeFrameSimilarity,
    postSceneChangeFrameSimilarity,
    deltaOfDeltas,
  }
  
}

async function calculateOffset(video1, video2, options) {

  //TODO add cli progress output

  //TODO add support for options.offsetEstimate
  //TODO add flag to specify search direction (e.g. if known whether the source is ahead or behind the destination)

  const video1SearchLength = 300 * 1000
  const searchIncrementSize = 10000 // maximum search area to find the next scene before switching sides
  const startTime = Date.now();
  
  // create the tmp folder if it doesn't exist yet
  try {
    await fs.access(`tmp`)
  } catch (err) {
    await fs.mkdir(`tmp`)
  }
  
  // search starts upwards
  let direction = 1
  
  let video1Data = await ffprobe(video1)
  let video2Data = await ffprobe(video2)
  let video1Duration = Number(video1Data.format.duration) * 1000 // offset in ms
  let video2Duration = Number(video2Data.format.duration) * 1000 // offset in ms
  let video1SearchStart = Math.round(video1Duration/4)
  let video1SearchEnd = Math.min(video1SearchStart + (direction * video1SearchLength), video1Duration) // make sure to not search beyond the last frame
  
  let video1SceneChange
  try {
    video1SceneChange = await findNextSceneChange(video1, video1SearchStart, video1SearchEnd)
  } catch (err) {
    throw new Error(`Didn't find a scene change in the destination video, can't synchronize videos!`)
  }

  console.debug(`Video 1 pre-scene change frame offset:`, video1SceneChange.preSceneChangeFrame.offset)
  let currentSearchStart = video1SceneChange.preSceneChangeFrame.offset - (direction * 3*stepSizeSmall) // move the offset back a bit to make sure the 0 ms offset is included in the first iteration
  // currentSearchStart = video1SceneChange.preSceneChangeFrame.offset - 70 * 1000 //FIXME implement `estimate` option

  // initialize offsets with the same value
  let currentSearchOffsets = {
    lower: currentSearchStart,
    upper: currentSearchStart,
  }
  
  // make sure to stay within offset bounds
  // continue while at least one side still within the bounds
  while (
    currentSearchOffsets.upper < video2Duration &&
    currentSearchOffsets.lower > 0 &&
    ((currentSearchOffsets.upper - video1SceneChange.preSceneChangeFrame.offset) < options.maxOffset ||
    (video1SceneChange.preSceneChangeFrame.offset - currentSearchOffsets.lower) < options.maxOffset)
  ) {

    console.log(`Finding scene change in other video...`)  
    
    currentSearchStart = direction === 1 ? currentSearchOffsets.upper : currentSearchOffsets.lower
    console.log(`currentSearchOffset:`, currentSearchStart)
    // make sure not to search past the start or end of the file
    let currentSearchEnd = direction === 1 ?
      Math.max(currentSearchStart + (direction*searchIncrementSize), 0) :
      Math.min(currentSearchStart + (direction*searchIncrementSize), video2Duration)

    let sceneComparison
    try {
      sceneComparison = await searchForMatchingScene(video2, video1SceneChange, currentSearchStart, currentSearchEnd)
    } catch (err) {
      // no scene change found until currentSearchEnd
      
      console.log(`No scene change found until currentSearchEnd (${currentSearchEnd})`);
      
      if (direction === 1) {
        currentSearchOffsets.upper = currentSearchEnd
        console.log(`Current offset (upper):`, ms(currentSearchOffsets.upper - video1SceneChange.preSceneChangeFrame.offset));
      } else {
        currentSearchOffsets.lower = currentSearchEnd
        console.log(`Current offset (lower):`, ms(video1SceneChange.preSceneChangeFrame.offset - currentSearchOffsets.lower));
      }

      // only change direction if the other direction hasn't surpassed the offset yet
      if (
        (direction === 1 && (video1SceneChange.preSceneChangeFrame.offset - currentSearchOffsets.lower) < options.maxOffset) ||
        (direction === -1 && (currentSearchOffsets.upper - video1SceneChange.preSceneChangeFrame.offset) < options.maxOffset)
      ) {
        direction = direction * -1
        console.debug(`changing direction to ${direction}`)
      } else {
        console.debug(`NOT changing direction!`)
      }
      
      continue
    }
    
    console.log(`sceneComparison:`, sceneComparison)

    if (
      (sceneComparison.preSceneChangeFrameSimilarity > 0.6 && sceneComparison.postSceneChangeFrameSimilarity > 0.6 && (await sceneComparison).deltaOfDeltas < 0.03) ||
      (sceneComparison.preSceneChangeFrameSimilarity > 0.9 && sceneComparison.postSceneChangeFrameSimilarity > 0.9 && (await sceneComparison).deltaOfDeltas < 0.1)
    ) {
      // matching scene found
      console.info(`Found matching scene after ${ms(Date.now() - startTime)}`);

      // remove tmp folder
      await fs.rm(`tmp`, {
        recursive: true,
        force: true,
      })
      return {
        videoOffset: video1SceneChange.preSceneChangeFrame.offset - sceneComparison.video2SceneChange.preSceneChangeFrame.offset,
        confidence: 1,
      }
      
    } else {
      // retry the same with different offsets

      if (direction === 1) {
        currentSearchOffsets.upper = sceneComparison.video2SceneChange.postSceneChangeFrame.offset
        console.debug(`Current offset (upper):`, ms(currentSearchOffsets.upper - video1SceneChange.postSceneChangeFrame.offset));
      } else {
        currentSearchOffsets.lower = sceneComparison.video2SceneChange.preSceneChangeFrame.offset
        console.debug(`Current offset (lower):`, ms(video1SceneChange.preSceneChangeFrame.offset - currentSearchOffsets.lower));
      }

      // only change direction if the other direction hasn't surpassed the offset yet
      if (
        (direction === 1 && (video1SceneChange.preSceneChangeFrame.offset - currentSearchOffsets.lower) < options.maxOffset) ||
        (direction === -1 && (currentSearchOffsets.upper - video1SceneChange.preSceneChangeFrame.offset) < options.maxOffset)
      )  {
        direction = direction * -1
        console.debug(`changing direction to ${direction}`)
      } else {
        console.debug(`NOT changing direction!`)
      }
      
    }
    
  }

  // remove tmp folder
  await fs.rm(`tmp`, {
    recursive: true,
    force: true,
  })
  
  throw new Error(`Couldn't sync videos! (tried for ${ms(Date.now() - startTime)}`)
  
}
module.exports.calculateOffset = calculateOffset

// calculateOffset(`/mnt/c/Users/Chaphasilor/Videos/hobbit_1_ee.mp4`, `/mnt/c/Users/Chaphasilor/Videos/The Hobbit - An Unexpected Journey (Extended Edition).mp4`, 90*1000)
// calculateOffset(`/mnt/c/Users/Chaphasilor/Videos/Star Wars - The Bad Batch - 1x03.mkv`, `/mnt/c/Users/Chaphasilor/Videos/BadBatchCopy.mkv`, 90*1000)
// calculateOffset(`/mnt/v/Media/TV Shows/Game of Thrones (2011)/Season 6/Game of Thrones - 6x01.mkv`, `/mnt/v/Media/TV Shows/Game of Thrones (2011) (de)/S6/Game of Thrones - S6E1.mp4`, 90*1000)
// calculateOffset(`/mnt/v/Media/TV Shows/Game of Thrones (2011)/Season 6/Game of Thrones - 6x03.mkv`, `/mnt/v/Media/TV Shows/Game of Thrones (2011) (de)/S6/Game of Thrones - S6E3.mp4`, 90*1000)
//!!!
// calculateOffset(`/mnt/c/Users/Chaphasilor/Videos/Game of Thrones - 7x02.mkv`, `/mnt/c/Users/Chaphasilor/Videos/Game of Thrones - S7E02.mp4`, {
// calculateOffset(`/mnt/c/Users/Chaphasilor/Videos/Game of Thrones - 7x02.mkv`, `/mnt/v/Media/TV Shows/Game of Thrones (2011) (de)/HQ/Staffel 7/Game of Thrones 0702.mp4`, {
//   maxOffset: 240*1000,
// })
// .then(async result => {

//   console.log(result)
  
// })
// .finally(async () => {
//   await fs.writeFile(`checkedOffsets.csv`, checkedOffsets.map(x => `${x}, 1`).join(`\n`))
//   await fs.rm(`tmp`, {
//     recursive: true,
//     force: true,
//   })
// })

//[ ] when automating, use the previously found offset as an estimate for following videos (if videos from the same source) 

//[ ] what happens when there are multiple similar scene changes?