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

module.exports.ALGORITHMS = ALGORITHMS

module.exports.calcOffset = async function(video1Path, video2Path, offset1, offset2, options = {
  algorithm: ALGORITHMS.SSIM,
}) {

  const spinner = ora(`Syncing the videos...`).start();

  let staticFrameDir = await fs.mkdtemp(`${os.tmpdir()}/static`)
  let rollingFramesDir = await fs.mkdtemp(`${os.tmpdir()}/frames`)
  console.log(`staticFrameDir:`, staticFrameDir)
  console.log(`rollingFramesDir:`, rollingFramesDir)

  const videoDimensions = await getVideoDimensions(video1Path, video2Path)
  const video1IsLarger = videoDimensions[0].width >= videoDimensions[1].width 

  const staticFrameInput = video1IsLarger ? video1Path : video2Path
  const rollingFrameInput = video1IsLarger ? video2Path : video1Path

  const staticFrameOffset = parseInt(video1IsLarger ? offset1 : offset2)
  const rollingFrameOffset = parseInt(video1IsLarger ? offset2 : offset1)

  let staticFrame = (await extractFrames({
    input: staticFrameInput,
    outputDir: staticFrameDir,
    offsets: [staticFrameOffset],
  }))[0]
  const staticFramePath = `${staticFrameDir}/${staticFrame.filename}`
  
  //TODO blackbar detection and removal
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
  
  let searchCenter = rollingFrameOffset // in milliseconds
  let searchResolution = parseInt((options.searchResolution))
  let closestMatch
  for (let iteration = 1; iteration <= options.iterations; iteration++) {
  
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
    
    closestMatch = await findClosestFrame(staticFramePath, rollingFramesDir, options.algorithm)

    console.debug(`closestMatch:`, closestMatch)

    let closestOffset = exportedFrames.find(frame => frame.filename === closestMatch.filename)?.offset
    console.log(`closestOffset:`, closestOffset)
    searchCenter = closestOffset

    if (closestMatch.value === 1) {
      break
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

async function getVideoDimensions(vid1, vid2) {

  console.log(`vid1:`, vid1)
  console.log(`vid2:`, vid2)
  let vid1Data = await probe(vid1)
  let vid2Data = await probe(vid2)
  console.log(`vid2:`, vid2)

  console.log(`Video 1: width: ${vid1Data.streams[0].width}, height: ${vid1Data.streams[0].height}`)
  console.log(`Video 2: width: ${vid2Data.streams[0].width}, height: ${vid2Data.streams[0].height}`)

  if (vid1Data.streams[0].width > vid2Data.streams[0].width && vid1Data.streams[0].height < vid2Data.streams[0].height) {
    console.warn(`Videos have different aspect ratios. You might get worse results.`)
  }

  return [
    {
      width: vid1Data.streams[0].width,
      height: vid1Data.streams[0].height,
    },
    {
      width: vid2Data.streams[0].width,
      height: vid2Data.streams[0].height,
    },
  ]
  
}