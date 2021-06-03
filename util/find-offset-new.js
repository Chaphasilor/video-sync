const os = require(`os`)
const fs = require('fs/promises')
const { exec } = require(`node-exec-promise`)
const { performance } = require(`perf_hooks`)
const ffprobe = require(`node-ffprobe`)
const bmp = require(`bmp-js`)
const resizeImg = require('resize-img')
const ssim = require(`ssim.js`).default
const ms = require(`ms`)

// const stepSize = 250
const stepSize = 25
const stepSizeSmall = 25
const stepSizeLarge = 1000

async function findNextSceneChange(video, startOffset, endOffset) {

  let currentStepSize = stepSizeLarge
  const steps = Math.ceil((endOffset - startOffset) / currentStepSize)

  let framesDir = await fs.mkdtemp(`${os.tmpdir()}/frames`)
  
  let seekPosition = startOffset / 1000.0
  let fullOutputPath = `${framesDir}/screenshot_${performance.now()*10000000000000}.bmp`  

  console.log(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${video}" -vframes 200 -vf cropdetect=24:2:0 -f null - -y`);
  console.log(`seekPosition:`, ms(startOffset))
  let blackBarResult = await exec(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${video}" -vframes 200 -vf cropdetect=24:2:0 -f null - -y`)
  let cropValue = blackBarResult.stderr.split(`\n`).splice(-4, 1)[0].match(/crop=(\d+\:\d+:\d+:\d+)/)[1]
  console.log(`cropValue:`, cropValue)
  
  // extract the first frame
  await exec(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${video}" -vf crop=${cropValue} -frames:v 1 "${fullOutputPath}" -y -loglevel error`)
  console.log(`fullOutputPath:`, fullOutputPath)
  
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
  let delta

  while (currentFrameOffset < endOffset) {
    
    seekPosition = currentFrameOffset / 1000.0
    fullOutputPath = `${framesDir}/screenshot_${performance.now()*10000000000000}.bmp`  

    // extract the frame
    await exec(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${video}" -vf crop=${cropValue} -frames:v 1 "${fullOutputPath}" -y -loglevel error`)
    console.log(`fullOutputPath:`, fullOutputPath)
    
    currentFrameData = bmp.decode(await fs.readFile(fullOutputPath), {
      format: `bmp`,
    })

    currentFrame = {
      offset: currentFrameOffset,
      path: fullOutputPath,
      data: currentFrameData,
    }

    delta = 1 - ssim(previousFrame.data, currentFrame.data).mssim;
    console.log(`delta:`, delta)

    if (delta > 0.5) {
      // scene change detected

      if (currentStepSize === stepSizeSmall) {
        // already in high-accuracy mode

        return {
          preSceneChangeFrame: previousFrame,
          postSceneChangeFrame: currentFrame,
          delta,
        }

      } else {
        console.log(`Switching to high-accuracy mode...`);

        // backtrack to preSceneChange frame offset
        // previousFrame is the preSceneChange frame, so in the next iteration previous and current frame will be the same, that's fine
        currentFrameOffset = previousFrame.offset
        currentStepSize = stepSizeSmall // switch to small step size for increased accuracy
        // fs.unlink(currentFrame.path) // discard old, unneeded frame
        
      }
      
    } else {
      fs.unlink(previousFrame.path) // discard old, unneeded frame
      previousFrame = currentFrame
    }

    currentFrameOffset += currentStepSize // go to next frame based on current step size
    
  }

  throw new Error(`No scene change found`)

  // return (path to + offset of) frame before scene change, (path to + offset of) frame after scene change, delta
  // other function uses distance between offsets as step size
  
}

// findSceneChange(`/mnt/v/Media/TV Shows/Game of Thrones (2011) (de)/S8/Game of Thrones - S8E01 (german).mp4`).then(console.log)
// findSceneChange(`/mnt/c/Users/Chaphasilor/Videos/hobbit_1_ee.mp4`).then(console.log)

async function calculateOffset(video1, video2) {

  let video1Data = await ffprobe(video1)
  let video1Duration = Number(video1Data.format.duration) * 1000 // offset in ms
  let offset1 = Math.round(video1Duration/2)
  let video1SceneChange = await findNextSceneChange(video1, offset1, offset1 + 60000)

  let offset2 = video1SceneChange.preSceneChangeFrame.offset - 3*stepSize // use multiples of `findNextSceneChange()`'s stepSize
  console.log(`Finding scene change in other video...`)
  let video2SceneChange = await findNextSceneChange(video2, offset2, offset2 + 5000)

  if (video1SceneChange.preSceneChangeFrame.data.width !== video2SceneChange.preSceneChangeFrame.data.width || video1SceneChange.preSceneChangeFrame.data.height !== video2SceneChange.preSceneChangeFrame.data.height) {
    console.log(`resizing...`)
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

  console.log(`preSceneChangeFrameSimilarity:`, preSceneChangeFrameSimilarity)
  console.log(`postSceneChangeFrameSimilarity:`, postSceneChangeFrameSimilarity)
  console.log(`Math.abs(video1SceneChange.delta - video2SceneChange.delta):`, Math.abs(video1SceneChange.delta - video2SceneChange.delta))
  
  if (
    (preSceneChangeFrameSimilarity > 0.6 && postSceneChangeFrameSimilarity > 0.6 && Math.abs(video1SceneChange.delta - video2SceneChange.delta) < 0.03) ||
    (preSceneChangeFrameSimilarity > 0.9 && postSceneChangeFrameSimilarity > 0.9 && Math.abs(video1SceneChange.delta - video2SceneChange.delta) < 0.1)
  ) {
    // matching scene found
    return video1SceneChange.preSceneChangeFrame.offset - video2SceneChange.preSceneChangeFrame.offset
  } else {
    //TODO retry the same with different offsets
  }

  return false

}

calculateOffset(`/mnt/c/Users/Chaphasilor/Videos/hobbit_1_ee.mp4`, `/mnt/c/Users/Chaphasilor/Videos/The Hobbit - An Unexpected Journey (Extended Edition).mp4`)
// calculateOffset(`/mnt/c/Users/Chaphasilor/Videos/Star Wars - The Bad Batch - 1x03.mkv`, `/mnt/c/Users/Chaphasilor/Videos/BadBatchCopy.mkv`)
// calculateOffset(`/mnt/v/Media/TV Shows/Game of Thrones (2011)/Season 6/Game of Thrones - 6x01.mkv`, `/mnt/v/Media/TV Shows/Game of Thrones (2011) (de)/S6/Game of Thrones - S6E1.mp4`)
// calculateOffset(`/mnt/v/Media/TV Shows/Game of Thrones (2011)/Season 6/Game of Thrones - 6x03.mkv`, `/mnt/v/Media/TV Shows/Game of Thrones (2011) (de)/S6/Game of Thrones - S6E3.mp4`)
// calculateOffset(`/mnt/v/Media/TV Shows/Game of Thrones (2011)/Season 8/Game of Thrones - 8x01.mkv`, `/mnt/v/Media/TV Shows/Game of Thrones (2011) (de)/S8/Game of Thrones - S8E01 (german).mp4`)
.then(console.log)


// (async () => {
//   // let img = await resizeImg(await fs.readFile(`/mnt/c/Users/Chaphasilor/Downloads/frames2DBqeD/screenshot_1789445974999964200.bmp`), {
//   //   format: `bmp`,
//   //   width: 720,
//   //   height: 400,
//   // })
  
//   // await fs.writeFile(`/mnt/c/Users/Chaphasilor/Downloads/frames2DBqeD/resized.bmp`, img)
//   let result = ssim(
//     // bmp.decode(await fs.readFile(`/mnt/c/Users/Chaphasilor/Videos/test1.bmp`)),
//     bmp.decode(await resizeImg(await fs.readFile(`/mnt/c/Users/Chaphasilor/Downloads/framesKKDfwj/screenshot_1814112755999937500.bmp`), {
//       format: `bmp`,
//       width: 1920,
//       height: 960,
//     })),
//     bmp.decode(await fs.readFile(`/mnt/c/Users/Chaphasilor/Downloads/frames2DBqeD/screenshot_1789445974999964200.bmp`))
//   ).mssim
//   console.log(`result:`, result)
// })()

// use `findSceneChange()` to find scene changes in the other video, starting at the new offset
// every time a scene change is found, compare the delta, as well as both pre- and both post-scene change frames with each other to determine, if the same scene change has been found
// if not found in an iteration, increase the search radius, excluding the already searched offsets (except for the edges)

//TODO ~~maybe use smaller step sizes?~~ use large step sizes to find the scene change fast, than go back to the current preSceneChange frame and use very small step sizes to find the exact frames, return the used step size for use with the other video
//TODO if the scene change can't be found around 0ms offset, increase the search radius in 5-10s increments (left and right), possibly searching from the inside out
//TODO add a `searchDirection` or `decrement/increment` param to the findNextSceneChange function
// just save the previous end offset (postSceneChange frame) for both sides and continue there, making sure to not search longer than the increment on either side (in order to search more or less evenly)
// don't forget to swap pre- and postSceneChange frames when searching from right to left
//TODO search until the scene is found or until a maximum offset (e.g. 5m) is reached on both sides
//TODO add flag to specify search direction (e.g. if known whether the source is ahead or behind the destination)

//[ ] when automating, use the previously found offset as an estimate for following videos (if videos from the same source) 