const { exec } = require(`child_process`)
const probe = require(`node-ffprobe`)

module.exports = function(vid1, vid2) {
  return new Promise((resolve, reject) => {
  
    let detectedTracks = []

    let identifier = exec(`mkvmerge ${vid1} -i`)
    // let identifier = exec(`mkvmerge ${[`"/mnt/c/Users/Chaphasilor/Videos/His Dark Materials  - 1x06.mp4"`, `-i`].join(` `)}`)
    identifier.stdout.setEncoding(`utf8`)
    identifier.stderr.setEncoding(`utf8`)

    identifier.stdout.on('data', (data) => {

      let extractor = /Track ID (\d): ([a-zA-Z]+) \((.*)\)/
      data.split(`\n`).forEach(line => {
        console.log(`line:`, line)
        if (extractor.test(line)) {
          let result = line.match(extractor)
          detectedTracks.push({
            id: result[1],
            type: result[2],
            format: result[3],
          })
        } else {
          console.log(`no match`)
        }
      })
      console.debug(`stdout: ${data}`);
    });
    identifier.stderr.on('data', (data) => {
      console.warn(`Error from mkvmerge: ${data}`);
    });

    identifier.on('close', async (code, signal) => {

      if (!code) {
        new Error(`mkvmerge was killed by '${signal}'`);
      }
      if (code !== 1) {
        new Error(`mkvmerge exited with code '${code}'`);
      }

      console.log(`detectedTracks:`, detectedTracks)

      if (detectedTracks.length > 0) {

        let vidData = await probe("/mnt/c/Users/Chaphasilor/Videos/3.mp4")
        offset = Number(offset) + Number(vidData.streams[1].start_time)*1000
        console.info(`Final offset is ${offset} ms`)

        console.log(`mkvmerge ${[`-o "/mnt/c/Users/Chaphasilor/Videos/out.mkv"`, `"/mnt/c/Users/Chaphasilor/Videos/WandaVision - 1x03.mp4"`,  `-D`, `-a ${detectedTracks[1].id}`, `--sync ${detectedTracks[1].id}:${offset}`, `"/mnt/c/Users/Chaphasilor/Videos/3.mp4"`].join(` `)}`)
        let merger = exec(`mkvmerge ${[`-o "/mnt/c/Users/Chaphasilor/Videos/out.mkv"`, `"/mnt/c/Users/Chaphasilor/Videos/WandaVision - 1x03.mp4"`,  `-D`, `-a ${detectedTracks[1].id}`, `--sync ${detectedTracks[1].id}:${offset}`, `"/mnt/c/Users/Chaphasilor/Videos/3.mp4"`].join(` `)}`)

        // console.log(`mkvmerge ${[`-o out.mkv`, `"/mnt/c/Users/Chaphasilor/Videos/His Dark Materials  - 1x06.mp4"`,  `-D`, `-a ${detectedTracks[1].id}`, `--sync ${detectedTracks[1].id}:${offset}`, `"/mnt/c/Users/Chaphasilor/Videos/His Dark Materials - 1x06 (german).mkv"`].join(` `)}`)
        // let merger = exec(`mkvmerge ${[`-o out.mkv`, `"/mnt/c/Users/Chaphasilor/Videos/His Dark Materials  - 1x06.mp4"`,  `-D`, `-a ${detectedTracks[1].id}`, `--sync ${detectedTracks[1].id}:${offset}`, `"/mnt/c/Users/Chaphasilor/Videos/His Dark Materials - 1x06 (german).mkv"`].join(` `)}`)

        merger.stdout.setEncoding(`utf8`)
        merger.stderr.setEncoding(`utf8`)

        merger.stdout.on('data', (data) => {

          console.debug(`stdout: ${data}`);
        });
        merger.stderr.on('data', (data) => {
          console.warn(`Error from mkvmerge: ${data}`);
        });

        merger.on('close', (code, signal) => {

          if (!code) {
            new Error(`mkvmerge was killed by '${signal}'`);
          }
          if (code !== 1) {
            new Error(`mkvmerge exited with code '${code}'`);
          }

        })
        
      }

    })
  
  })
}

function getTracks(vid) {

  return new Promise((resolve, reject) => {
  
    let detectedTracks = []

    let identifier = exec(`mkvmerge ${vid1} -i`)
    // let identifier = exec(`mkvmerge ${[`"/mnt/c/Users/Chaphasilor/Videos/His Dark Materials  - 1x06.mp4"`, `-i`].join(` `)}`)
    identifier.stdout.setEncoding(`utf8`)
    identifier.stderr.setEncoding(`utf8`)

    identifier.stdout.on('data', (data) => {

      let extractor = /Track ID (\d): ([a-zA-Z]+) \((.*)\)/
      data.split(`\n`).forEach(line => {
        console.log(`line:`, line)
        if (extractor.test(line)) {
          let result = line.match(extractor)
          detectedTracks.push({
            id: result[1],
            type: result[2],
            format: result[3],
          })
        } else {
          console.log(`no match`)
        }
      })
      console.debug(`stdout: ${data}`);
    });
    identifier.stderr.on('data', (data) => {
      console.warn(`Error from mkvmerge: ${data}`);
    });

    identifier.on('close', async (code, signal) => {

      if (!code) {
        new Error(`mkvmerge was killed by '${signal}'`);
      }
      if (code !== 1) {
        new Error(`mkvmerge exited with code '${code}'`);
      }

      console.log(`detectedTracks:`, detectedTracks)

      if (detectedTracks.length > 0) {

        let vidData = await probe("/mnt/c/Users/Chaphasilor/Videos/3.mp4")
        offset = Number(offset) + Number(vidData.streams[1].start_time)*1000
        console.info(`Final offset is ${offset} ms`)



        
        
      }

    })
  
  })
  
}

async function getVideoInfo(vid) {

  let vidData = await probe(vid)

  return vidData.streams.map(stream => {
    return {
      width: Number(stream.width),
      height: Number(stream.height),
      codec: stream.codec_name,
      offset: Number(stream.start_time)*1000, // calc milliseconds
    }
  })
  
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
