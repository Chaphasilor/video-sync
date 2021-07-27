const fs = require('fs/promises')
const { exec } = require(`node-exec-promise`)
const { performance } = require(`perf_hooks`)
const bmp = require(`bmp-js`)
const ssim = require(`ssim.js`).default
const ora = require('ora');
const resizeImg = require('resize-img')
const { getVideoInfo } = require("./calc-offset")

async function findClosestFrame(destinationVideo, sourceVideo, destinationTimestamp, offset, radius, stepSize) {

  // create the tmp folder if it doesn't exist yet
  try {
    await fs.access(`tmp`)
  } catch (err) {
    await fs.mkdir(`tmp`)
  }
  const framesDir = await fs.mkdtemp(`tmp/frames`)
  
  let seekPosition = destinationTimestamp / 1000.0
  let destinationFrame
  let similarity
  let blackBarResult
  let cropValueDestination
  let cropValueSource

  // determine crop value for destination video
  blackBarResult = await exec(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${destinationVideo}" -vframes 200 -vf cropdetect=24:2:0 -f null - -y`)
  cropValueDestination = blackBarResult.stderr.split(`\n`).splice(-4, 1)[0].match(/crop=(\d+\:\d+:\d+:\d+)/)[1]

  // determine crop value for destination video
  blackBarResult = await exec(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${sourceVideo}" -vframes 200 -vf cropdetect=24:2:0 -f null - -y`)
  cropValueSource = blackBarResult.stderr.split(`\n`).splice(-4, 1)[0].match(/crop=(\d+\:\d+:\d+:\d+)/)[1]


  // create reference frame
  destinationFrame = {
    offset: destinationTimestamp / 1000.0,
    path: `${framesDir}/screenshot_${performance.now()*10000000000000}.bmp`,
    data: null,
  }

  destinationFrame.data = await extractFrame(destinationVideo, destinationFrame.offset, cropValueDestination, destinationFrame.path)

  mostSimilarFrame = {
    offset: 0,
    similarity: -1,
  }
  
  // extract frame, check similarity, delete it
  for (let currentOffset = offset-radius; currentOffset <= offset+radius; currentOffset += stepSize) {

    seekPosition = (destinationTimestamp + currentOffset) / 1000.0
    fullOutputPath = `${framesDir}/screenshot_${performance.now()*10000000000000}.bmp`  

    let frameData = await extractFrame(sourceVideo, seekPosition, cropValueSource, fullOutputPath)

    //TODO instead of only checking image dimensions at the end, do it at the start and then generate the frames from the smaller video
    //!!! make sure to use the negated offset when swapping source and destination! 
    if (destinationFrame.width !== frameData.width || destinationFrame.height !== frameData.height) {
      // make sure to always downsize
      if (destinationFrame.width*destinationFrame.height >= frameData.width*frameData.height) {
        // resize destination frame once
        destinationFrame.data = bmp.decode(await resizeImg(await fs.readFile(destinationFrame.path), {
          format: `bmp`,
          width: frameData.width,
          height: frameData.height,
        }));
      } else {
        // resize every source frame
        frameData = bmp.decode(await resizeImg(await fs.readFile(fullOutputPath), {
          format: `bmp`,
          width: destinationFrame.data.width,
          height: destinationFrame.data.height,
        }));
      }
    }

    similarity = ssim(frameData, destinationFrame.data).mssim;

    if (similarity > mostSimilarFrame.similarity) {
      mostSimilarFrame = {
        offset: currentOffset,
        similarity,
      }
    }
    
  }

  // remove tmp folder
  await fs.rm(`tmp`, {
    recursive: true,
    force: true,
  })

  return mostSimilarFrame
  
}

async function extractFrame(video, offset, cropValue, path) {

  // extract the frame
  await exec(`ffmpeg -accurate_seek -ss ${offset} -i "${video}" -vf crop=${cropValue} -frames:v 1 "${path}" -y -loglevel error`)

  // load the bitmap into memory
  const frameData = bmp.decode(await fs.readFile(path), {
    format: `bmp`,
  })

  return frameData
  
}

async function validateOffset(destinationVideo, sourceVideo, offsetToTest) {

  const testPositions = [
    0.1,
    0.8,
  ]
  const testRadius = 500
  const testStepSize = 50

  const videoInfo = await getVideoInfo(destinationVideo, sourceVideo)

  const mostSimilarFrameOffsets = []

  for (const position of testPositions) {
    
    mostSimilarFrameOffsets.push(
      (await findClosestFrame(destinationVideo, sourceVideo, Math.round(videoInfo.lengths[0] * position), offsetToTest, testRadius, testStepSize)).offset
    )
    
  }

  console.debug(`mostSimilarFrameOffsets:`, mostSimilarFrameOffsets)

  const offsetDelta = Math.abs(Math.max(...mostSimilarFrameOffsets) - Math.min(...mostSimilarFrameOffsets))
  if (offsetDelta > 250) {
    return false
  }

  return true
  
}
module.exports.validateOffset = validateOffset
