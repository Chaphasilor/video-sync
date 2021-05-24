const { exec } = require(`node-exec-promise`)
const fs = require(`fs/promises`)

module.exports = async function extractFrames(options) {

  let filesToRemove = (await fs.readdir(options.outputDir, { withFileTypes: true })).filter(x => x.isFile())
  for (const file of filesToRemove) {
    await fs.rm(`${options.outputDir}/${file.name}`)
  }
  
  let exportedFrames = []
  for (const index in options.offsets) {

    let offsetInMillis = options.offsets[index]

    let currentFrame = {
      offset: offsetInMillis,
      filename: `screenshot_${index}.bmp`,
    }

    const seekPosition = currentFrame.offset / 1000.0
    const fullOutputPath = `${options.outputDir}/${currentFrame.filename}`  
    
    await exec(`ffmpeg -accurate_seek -ss ${seekPosition} -i "${options.input}" -frames:v 1 "${fullOutputPath}" -y -loglevel error`)
    exportedFrames.push(currentFrame)

  }

  console.log(`Extracted all frames.`)
  
  return exportedFrames
  
}