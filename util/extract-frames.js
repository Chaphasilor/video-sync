const { execSync } = require(`child_process`)
const fs = require(`fs`)

module.exports = function extractFrames(options) {

  fs.readdirSync(options.outputDir, { withFileTypes: true }).filter(x => x.isFile()).forEach(x => fs.rmSync(`${options.outputDir}/${x.name}`))
  
  let exportedFrames = []
  options.offsets.forEach((offsetInMillis, index) => {

    let currentFrame = {
      offset: offsetInMillis,
      filename: `screenshot_${index}.bmp`,
    }

    const seekPosition = currentFrame.offset / 1000.0
    const fullOutputPath = `${options.outputDir}/${currentFrame.filename}`  
    
    exportedFrames.push(currentFrame)
    execSync(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${options.input}" -frames:v 1 "${fullOutputPath}" -y -loglevel error`)

  })

  console.log(`Extracted all frames.`)
  
  return exportedFrames
  
}