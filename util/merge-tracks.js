const { exec } = require(`child_process`)
const probe = require(`node-ffprobe`)

module.exports = function(video1, video2, offset) {
  return new Promise((resolve, reject) => {
  
    let detectedTracks = []

    let identifier = exec(`mkvmerge "${video2}" -i`)
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

        let vidData = await probe(video2)
        offset = Number(offset) + Number(vidData.streams[1].start_time)*1000 //TODO compensate for video offset
        console.info(`Final offset is ${offset} ms`)

        console.log(`mkvmerge ${[`-o "out.mkv"`, `"${video1}"`,  `-D`, `-a ${detectedTracks[1].id}`, `--sync ${detectedTracks[1].id}:${offset}`, `"${video2}"`].join(` `)}`)
        let merger = exec(`mkvmerge ${[`-o "out.mkv"`, `"${video1}"`,  `-D`, `-a ${detectedTracks[1].id}`, `--sync ${detectedTracks[1].id}:${offset}`, `"${video2}"`].join(` `)}`)

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
            return reject(new Error(`mkvmerge was killed by '${signal}'`));
          }
          if (code !== 1) {
            return reject(new Error(`mkvmerge exited with code '${code}'`));
          }

          return resolve()

        })
        
      }

    })
  
  })
}

