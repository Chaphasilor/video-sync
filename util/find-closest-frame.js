const fs = require('fs')
const PNG = require('pngjs').PNG
const bmp = require(`bmp-js`)
const pixelmatch = require('pixelmatch')
const resizeImg = require('resize-img')
const ssim = require(`ssim.js`).default

const ALGORITHMS = {
  MISMATCHED_PIXELS: `matching-pixels`,
  SSIM: `ssim`,
}
module.exports.ALGORITHMS = ALGORITHMS

module.exports.findClosestFrame = async function findClosestFrame(inputFile, frameInputDir, selectedAlg = ALGORITHMS.SSIM) {

  const inputImage = bmp.decode(fs.readFileSync(inputFile))
  const { width, height } = inputImage

  console.log(`Looking for closest matching frame...`)
  console.log(`Using algorithm '${selectedAlg}'`)

  const files = fs.readdirSync(frameInputDir, {
    withFileTypes: true
  }).filter(x => x.isFile())
  
  let closestMatch = {
    filename: undefined,
    value: selectedAlg === ALGORITHMS.SSIM ? -1 : Infinity,
  }
  
  for (const file of files) {
  
    let imageToCompare = bmp.decode(fs.readFileSync(`${frameInputDir}/${file.name}`));
    
    if (imageToCompare.width !== width || imageToCompare.height !== height) {
      console.log(`resizing...`)
      imageToCompare = bmp.decode(await resizeImg(fs.readFileSync(`${frameInputDir}/${file.name}`), {
        format: `bmp`,
        width,
        height,
      }));
    }
  
    let result
    if (selectedAlg === ALGORITHMS.SSIM) {
      result = ssim(inputImage, imageToCompare);
    } else {
      result = pixelmatch(inputImage.data, imageToCompare.data, null, width, height, {threshold: 0.1});
    }
  
    //TODO if closestMatch.value doesn't change at all, somethings fishy (e.g. static scene)
    // either try again with different offsets or prompt the user, but the former option would be more robust
    if (
      (selectedAlg === ALGORITHMS.SSIM && result.mssim > closestMatch.value) ||
      (selectedAlg === ALGORITHMS.MISMATCHED_PIXELS && result < closestMatch.value)
      ) {
        

      switch (selectedAlg) {
        case ALGORITHMS.SSIM:
          result = ssim(inputImage, imageToCompare);
          console.log(`result:`, result.mssim)
          if (result.mssim > closestMatch.value) {
            closestMatch = {
              filename: file.name,
              value: result.mssim,
            }
          }
          break;
        case ALGORITHMS.MISMATCHED_PIXELS:
          result = pixelmatch(inputImage.data, imageToCompare.data, null, width, height, {threshold: 0.1});
          console.log(`result:`, result)
          if (result < closestMatch.value) {
            closestMatch = {
              filename: file.name,
              value: result.mssim,
            }
          }
          break;
      
        default:
          throw new Error(`Invalid algorithm!`)
          break;
      }
    }
  
  }
  
  return closestMatch

}
