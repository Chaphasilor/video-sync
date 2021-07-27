const os = require(`os`)
const fs = require(`fs/promises`)
const probe = require(`node-ffprobe`)
const resizeImg = require(`resize-img`)
const ora = require('ora');

const extractFrames = require(`./extract-frames`)
const { ALGORITHMS, findClosestFrame } = require(`./find-closest-frame`)

function* offsetGenerator(start = 0, step = 1) {
  let iterationCount = start
  let prev
  while (true) {
    prev = iterationCount
    iterationCount += step
    yield prev
  }
}

function generateRandomSearchCenter(totalLength, padding) {

  console.log(`totalLength:`, totalLength)
  console.log(`padding:`, padding)
  let availableLength = totalLength - 2*padding
  let offset = Math.random() * availableLength + padding
  console.log(`offset:`, offset)
  return Number(offset.toFixed(2))
  
}

/**
 * Generates the static frame to be used (offset A)
 * @param {*} totalLength 
 * @param {*} padding 
 * @returns 
 */
async function generateRandomStaticFrame(offset, staticFrameInput, staticFrameDir) {

  console.log(`offset:`, offset)
  let staticFrame = (await extractFrames({
    input: staticFrameInput,
    outputDir: staticFrameDir,
    offsets: [offset],
  }))[0]
  return `${staticFrameDir}/${staticFrame.filename}`

}

module.exports.ALGORITHMS = ALGORITHMS

module.exports.calcOffset = async function(video1Path, video2Path, options = {
  comparisonAlgorithm: ALGORITHMS.SSIM,
}) {

  //TODO expose this
  const threshold = options.threshold

  const spinner = ora(`Syncing the videos...`).start();

  let staticFrameDir = await fs.mkdtemp(`${os.tmpdir()}/static`)
  let rollingFramesDir = await fs.mkdtemp(`${os.tmpdir()}/frames`)
  console.log(`staticFrameDir:`, staticFrameDir)
  console.log(`rollingFramesDir:`, rollingFramesDir)

  const videoInfo = await getVideoInfo(video1Path, video2Path)
  const videoDimensions = videoInfo.dimensions
  const video1IsLarger = videoDimensions[0].width >= videoDimensions[1].width 

  const staticFrameInput = video1IsLarger ? video1Path : video2Path
  const rollingFrameInput = video1IsLarger ? video2Path : video1Path

  // const staticFrameOffset = parseInt(video1IsLarger ? offset1 : offset2)
  // const rollingFrameOffset = parseInt(video1IsLarger ? offset2 : offset1)

  // generate the static frame using the video length and a padding of 1%
  console.log(`videoInfo.lengths:`, videoInfo.lengths)
  let staticLength = videoInfo.lengths[video1IsLarger ? 0 : 1]
  let staticFrameOffset = Math.round(staticLength/2)
  console.log(`staticFrameOffset:`, staticFrameOffset)
  let staticFramePath = await generateRandomStaticFrame(staticFrameOffset, staticFrameInput, staticFrameDir)
  
  //TODO !!! blackbar detection and removal
  await fs.writeFile(staticFramePath, await resizeImg(await fs.readFile(staticFramePath), {
    format: `bmp`,
    width: videoDimensions[1].width,
    height: videoDimensions[1].height,
  }))

  // TODO automatic syncing without specifying offsets
  // choose a random offset (padded at start and end)
  // try syncing at that offset
  // if the confidence stays the same for multiple frames => static scene => restart with different offset
  // if the confidence is too low at the end => restart with different offset
  // otherwise sync should work just fine
  
  // let searchCenter = rollingFrameOffset // in milliseconds
  let offsetB = options.offsetEstimate
  let searchCenter = staticFrameOffset + offsetB
  console.log(`searchCenter:`, searchCenter)
  let searchResolution = parseInt((options.searchResolution))
  let closestMatch
  let restarts = 0
  for (let iteration = 1; iteration <= options.iterations; iteration++) {
  
    if (restarts > 5) {
      throw new Error(`Couldn't determine the correct offset.`)
    }
    
    console.log(`iteration:`, iteration)

    let searchWidth = options.searchWidth / iteration
    
    console.log(`searchWidth:`, searchWidth)
    console.log(`searchCenter:`, searchCenter)
    console.debug(`parseInt((searchCenter - searchWidth*1000/2 ):`, parseInt((searchCenter - searchWidth*1000/2 )))
    console.debug(`searchWidth*1000 / searchResolution:`, searchWidth*1000 / searchResolution)

    const gen = offsetGenerator(parseInt((searchCenter - searchWidth*1000/2)), searchWidth*1000 / searchResolution)
    let offsets = new Array(searchResolution).fill(0).map(x => gen.next().value)

    let exportedFrames = await extractFrames({
      input: rollingFrameInput,
      outputDir: rollingFramesDir,
      offsets,
    })
  
    console.debug(`exportedFrames:`, exportedFrames)
    
    try {
      closestMatch = await findClosestFrame(staticFramePath, rollingFramesDir, options.comparisonAlgorithm, iteration === 0)
    } catch (err) {
      // finding an extact match not possible, use different offsets
      console.log(`Error while trying to find the closest matching frame: ${err.message}`)

      // generate the static frame using the video length and a padding of 1%
      let staticLength = videoInfo.lengths[video1IsLarger ? 0 : 1]
      let staticPadding = parseInt((staticLength* 0.01).toFixed(0))
      staticFrameOffset = generateRandomSearchCenter(staticLength, staticPadding)
      staticFramePath = await generateRandomStaticFrame(staticFrameOffset, staticFrameInput, staticFrameDir)
      searchCenter = staticFrameOffset + offsetB

      // restart iterating
      restarts++
      iteration = 0
      continue
      
    }

    console.debug(`closestMatch:`, closestMatch)

    let closestOffset = exportedFrames.find(frame => frame.filename === closestMatch.filename)?.offset
    console.log(`closestOffset:`, closestOffset)
    searchCenter = closestOffset

    if (closestMatch.value === 1) {
      break
    } else if (closestMatch.value < threshold) {

      console.log(`Didn't find a closely matching frame. Retrying with different offsets...`)
      //TODO expose interval
      // offset B
      offsetB = (Math.random() > 0.5 ? 1 : -1) * generateRandomSearchCenter(options.maxOffset * 1000, 0)
      searchCenter = staticFrameOffset + offsetB
      
      restarts++
      iteration = 0
      continue
      
    }
    
  }

  console.log(`staticFrameOffset ${video1IsLarger ? `vid1` : `vid2`}:`, staticFrameOffset)
  console.log(`searchCenter:`, searchCenter)
  
  let totalOffset = (staticFrameOffset - searchCenter).toFixed(0)
  console.log(`Video 2 is approx. ${Math.abs(totalOffset)} ms ${video1IsLarger && totalOffset > 0 ? `ahead` : `behind`} video 1 (${closestMatch.value})`)

  // cli.action.stop(`Done! Source video is approx. ${Math.abs(totalOffset)} ms ${video1IsLarger && totalOffset > 0 ? `ahead` : `behind`} destination video (confidence ${closestMatch.value.toFixed(5)}).`)
  spinner.succeed(`Source video is approx. ${Math.abs(totalOffset)} ms ${video1IsLarger && totalOffset > 0 ? `ahead` : `behind`} destination video (confidence ${closestMatch.value.toFixed(5)}).`)
  
  return {
    videoOffset: totalOffset,
    confidence: closestMatch.value.toFixed(5),
  }

}

async function getVideoInfo(vid1, vid2) {

  let vid1Data = await probe(vid1)
  let vid2Data = await probe(vid2)
  console.log(`vid1Data:`, vid1Data)
  console.log(`vid2Data:`, vid2Data)

  console.debug(`Video 1: width: ${vid1Data.streams[0].width}, height: ${vid1Data.streams[0].height}`)
  console.debug(`Video 2: width: ${vid2Data.streams[0].width}, height: ${vid2Data.streams[0].height}`)

  if (vid1Data.streams[0].width > vid2Data.streams[0].width && vid1Data.streams[0].height < vid2Data.streams[0].height) {
    console.warn(`Videos have different aspect ratios. You might get worse results.`)
  }

  return {
    lengths: [
      parseInt((Number(vid1Data.format.duration) * 1000).toFixed(0)),
      parseInt((Number(vid2Data.format.duration) * 1000).toFixed(0)),
    ],
    dimensions: [
      {
        width: vid1Data.streams[0].width,
        height: vid1Data.streams[0].height,
      },
      {
        width: vid2Data.streams[0].width,
        height: vid2Data.streams[0].height,
      },
    ],
  }
  
}
module.exports.getVideoInfo = getVideoInfo