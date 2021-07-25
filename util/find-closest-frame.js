const fs = require('fs/promises')
const PNG = require('pngjs').PNG
const bmp = require(`bmp-js`)
const pixelmatch = require('pixelmatch')
const resizeImg = require('resize-img')
const ssim = require(`ssim.js`).default

const { checkStaticScene } = require(`./static-scenes`)

const ALGORITHMS = {
  MISMATCHED_PIXELS: `matching-pixels`,
  SSIM: `ssim`,
}
module.exports.ALGORITHMS = ALGORITHMS

module.exports.findClosestFrame = async function findClosestFrame(inputFile, frameInputDir, selectedAlg = ALGORITHMS.SSIM, checkForStaticScene) {

  const inputImage = bmp.decode(await fs.readFile(inputFile))
  const { width, height } = inputImage

  console.log(`Looking for closest matching frame...`)
  console.log(`Using algorithm '${selectedAlg}'`)

  const files = (await fs.readdir(frameInputDir, {
    withFileTypes: true
  })).filter(x => x.isFile())

  let closestMatch = {
    filename: undefined,
    value: selectedAlg === ALGORITHMS.SSIM ? -1 : Infinity,
  }
  
  let results = []
  
  for (const file of files) {
  
    let imageToCompare = bmp.decode(await fs.readFile(`${frameInputDir}/${file.name}`));
    
    if (imageToCompare.width !== width || imageToCompare.height !== height) {
      console.log(`resizing...`)
      imageToCompare = bmp.decode(await resizeImg(await fs.readFile(`${frameInputDir}/${file.name}`), {
        format: `bmp`,
        width,
        height,
      }));
    }
  
    let result
    if (selectedAlg === ALGORITHMS.SSIM) {
      result = ssim(inputImage, imageToCompare).mssim;
    } else {
      result = pixelmatch(inputImage.data, imageToCompare.data, null, width, height, {threshold: 0.1});
    }

    results.push(result)
  
    //TODO also trigger on very slight fluctuations for high confidence scores (actual static scenes)
    // if closestMatch.value doesn't change at all, somethings fishy (e.g. static scene)
    // => try again with different offsets
    //TODO check if twice in a row works (because frames aren't exactly timed) or the limit has to be increased
    if (result === closestMatch.value) {
      throw new Error(`Got the same result twice, possible static scene!`)
    }
    
    console.log(`result:`, result)
    
    // update the new best result/closest match
    if (
      (selectedAlg === ALGORITHMS.SSIM && result > closestMatch.value) ||
      (selectedAlg === ALGORITHMS.MISMATCHED_PIXELS && result < closestMatch.value)
      ) {
        
      switch (selectedAlg) {
        case ALGORITHMS.SSIM:
          if (result > closestMatch.value) {
            closestMatch = {
              filename: file.name,
              value: result,
            }
          }
          break;
        case ALGORITHMS.MISMATCHED_PIXELS:
          if (result < closestMatch.value) {
            closestMatch = {
              filename: file.name,
              value: result,
            }
          }
          break;
      
        default:
          throw new Error(`Invalid algorithm!`)
          break;
      }

    }

    if (closestMatch.value === 1) {
      break
    }
  
  }

  if (checkForStaticScene && checkStaticScene({data: results})) {
    throw new Error(`Static scene detected!`)
  }
  
  return closestMatch

}
