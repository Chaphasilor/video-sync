const { exec, execSync } = require(`child_process`)
const fs = require("fs")
const probe = require(`node-ffprobe`)

function matchTracksAndStreams(video2) {
  return new Promise(async (resolve, reject) => {
  
    let mkvmergeInfo
    let ffprobeInfo
    
    // extract original info (e.g. track names) from video
    try {
      mkvmergeInfo = JSON.parse(execSync(`mkvmerge -J "${video2}"`))
    } catch (err) {
      console.debug(`mkvmerge error:`, err)
      return reject(new Error(`Error with mkvmerge. Is it installed and in your path?`))
    }

    // check if the video's tracks can be renamed in-place or if we need to create a mkv from it first
    // the first option is preferred if possible, because the second option takes many seconds
    let containerize = needsContainerization(video2)
    let videoToMatch = containerize ? `${video2}.match` : video2

    console.debug(`mkvmergeInfo:`, mkvmergeInfo)
    
    // filter out all video tracks (they are ignored by the tool)
    let audioTracks = mkvmergeInfo.tracks.filter(track => track.type === `audio`)
    let subsTracks = mkvmergeInfo.tracks.filter(track => track.type === `subtitles`)
    let videoTracks = mkvmergeInfo.tracks.filter(track => track.type === `video`)

    // remember original track names for renaming later
    let mkvmergeOldTrackNames = {
      audio: audioTracks.map(track => {
        return {
          id: track.id,
          name: track.properties[`track_name`]
        }
      }),
      subs: subsTracks.map(track => {
        return {
          id: track.id,
          name: track.properties[`track_name`]
        }
      }) 
    }
    console.debug(`mkvmergeOldTrackNames:`, mkvmergeOldTrackNames)

    let tracksToMatch = [...audioTracks, ...subsTracks]

    if (containerize) {
      // track can't be renamed in-place, so create a mkv from it

      try {
        
        await new Promise((resolve, reject) => {

          // videos tracks aren't copied anyway (`-D` flag), so just rename all other tracks
          let trackNameString = tracksToMatch.reduce((sum, track, id) => `${sum} --track-name ${track.id}:${id}`, ``)
          let trackOrderString = `--track-order ${mkvmergeInfo.tracks.reduce((sum, cur, index) => `${sum}${index === 0 ? `` : `,`}0:${cur.id}`, ``)}`
          console.log(`mkvmerge ${trackNameString} "${video2}" --no-cues -D ${trackOrderString} -o "${videoToMatch}"`)
          // let merger = exec(`mkvmerge ${trackNameString} "${video2}" --no-cues -D ${trackOrderString} -o "${videoToMatch}"`)
          // let merger = exec(`mkvmerge ${trackNameString} -D "${video2}" ${trackOrderString} --no-cues -o "${videoToMatch}"`)
          let merger = exec(`mkvmerge ${trackNameString} -D "${video2}" ${trackOrderString} --no-cues -o "${videoToMatch}"`)
    
          merger.stdout.setEncoding(`utf8`)
          merger.stderr.setEncoding(`utf8`)
    
          merger.stdout.on('data', (data) => {
            console.debug(`stdout: ${data}`);
          });
          merger.stderr.on('data', (data) => {
            console.warn(`Error from mkvmerge: ${data}`);
          });
    
          merger.on('close', (code, signal) => {
    
            if (code === null) {
              return reject(new Error(`mkvmerge was killed by '${signal}'`));
            }
            if (code !== 0) {
              return reject(new Error(`mkvmerge exited with code '${code}'`));
            }
    
            return resolve()
    
          })
  
        })

      } catch (err) {
        console.debug(`containerization error:`, err)
        return reject(new Error(`Error while converting the source video to Matroska. Do you have enough free space left (${fs.lstatSync(video2).size} bytes)?`))
      }

    } else {
      // tracks can be renamed in-place

      // build the flag string passed to mkvpropedit for renaming the audio tracks
      let highestGivenId = 0
      let editStringAudio = audioTracks.reduce((sum, track, id) => {
        return `${sum} --edit track:a${id+1} --set name=${highestGivenId++}`
      }, ``)
      let editStringSubs = subsTracks.reduce((sum, track, id) => {
        return `${sum} --edit track:s${id+1} --set name=${highestGivenId++}`
      }, ``)

      // apply the renaming using mkvpropedit
      try {
        let trackRenamer = execSync(`mkvpropedit "${videoToMatch}" ${editStringAudio} ${editStringSubs}`)
      } catch (err) {
        console.debug(`mkvpropedit error:`, err)
        return reject(new Error(`Error with mkvpropedit. Is it installed and in your path?`))
      }

    }

    // load track names and ids using mkvmerge
    try {
      mkvmergeInfo = JSON.parse(execSync(`mkvmerge -J "${videoToMatch}"`))
    } catch (err) {
      console.debug(`mkvmerge error:`, err)
      return reject(new Error(`Error with mkvmerge. The file with renamed tracks might be corrupted?`))
    }
    // console.debug(`mkvmergeInfo.tracks:`, mkvmergeInfo.tracks)
    
    // load stream names and ids using ffprobe
    try {
      ffprobeInfo = await probe(videoToMatch)
    } catch (err) {
      console.debug(`ffprobe error:`, err)
      return reject(new Error(`Error with ffprobe. Is it installed and in your path?`))
    }
    // console.debug(`ffprobeInfo.streams:`, ffprobeInfo.streams)

    // restore the tracks to their original names after in-place renaming
    if (containerize) {

      try {
        fs.rmSync(videoToMatch)
      } catch (err) {
        console.warn(`Couldn't delete (potentially very large) temporary files! You might wanna to this manually.\nPath: "${videoToMatch}"`)
      }
      
    } else {

      // build the flag string passed to mkvpropedit for restoring the audio tracks
      //!!! the mkvmerge track ids are not related to the `track:aX`-ids, they are just enumerated on a per-type basis
      //!!! this means that the order in which items inside mkvmergeOldTrackNames are is important! (it should be the same order as it was when renaming the first time)
      let editStringAudio = mkvmergeOldTrackNames.audio.reduce((sum, track, id) => {
        return track.name === undefined ? `${sum} --edit track:a${id+1} --delete name` : `${sum} --edit track:a${id+1} --set name='${track.name}'`
      }, ``)
      let editStringSubs = mkvmergeOldTrackNames.subs.reduce((sum, track, id) => {
        return track.name === undefined ? `${sum} --edit track:s${id+1} --delete name` : `${sum} --edit track:s${id+1} --set name='${track.name}'`
      }, ``)

      console.log(`mkvpropedit "${videoToMatch}" ${editStringAudio} ${editStringSubs}`)
      // apply the renaming using mkvpropedit
      try {
        let trackRenamer = execSync(`mkvpropedit "${videoToMatch}" ${editStringAudio} ${editStringSubs}`)
      } catch (err) {
        console.debug(`mkvpropedit error:`, err)
        return reject(new Error(`Error with mkvpropedit. The file with renamed tracks might be corrupted?`))
      }
      
    }

    let matchings = []
    // find ffprobe's stream index and mkvmerge's track id for each audio track found
    for (const i in tracksToMatch) {

      let trackOffset = containerize ? videoTracks.length : 0 // if a video was containerized, no video tracks were copied, which affects the indices/IDs
      let foundStream = ffprobeInfo.streams.find(stream => stream.tags.title === String(i))

      // make sure that all tracks found by mkvmerge are also found by ffprobe
      if (!foundStream) {
        return reject(new Error(`ffprobe didn't find all tracks found by mkvmerge. Can't automatically match the IDs!`)) // *very* unlikely to happen
      }
      let streamIndex = foundStream.index + trackOffset
      
      let trackInfo = mkvmergeInfo.tracks.find(track => track.properties[`track_name`] === String(i))

      if (!trackInfo) {
        return reject(new Error(`mkvmerge didn't find some renamed tracks. Aborting!`)) // even more unlikely
      }
      let trackId = trackInfo.id + trackOffset
      
      console.log(`Track #${i} has stream index '${streamIndex}' and track id '${trackId}'`)
      matchings.push({
        infos: {
          type: getTrackType(trackInfo),
          language: trackInfo.properties.language,
          languageIetf: trackInfo.properties.language_ietf
        },
        ids: {
          ffprobe: streamIndex,
          mkvmerge: trackId,
        }
      })
      
    }

    return resolve(matchings)
    
  })
}
module.exports.matchTracksAndStreams = matchTracksAndStreams

function needsContainerization(video) {

  let mkvmergeInfo = JSON.parse(execSync(`mkvmerge -J "${video}"`))
  return mkvmergeInfo.container.type !== `Matroska`
  
}
module.exports.needsContainerization = needsContainerization

function getTrackInfo(video) {

  let mkvmergeInfo
  
  // extract info (e.g. track names) from video
  try {
    mkvmergeInfo = JSON.parse(execSync(`mkvmerge -J "${video}"`))
  } catch (err) {
    console.debug(`mkvmerge error:`, err)
    throw new Error(`Error with mkvmerge. Is it installed and in your path?`)
  }
  let audioTracks = mkvmergeInfo.tracks.filter(track => track.type === `audio`)
  let subsTracks = mkvmergeInfo.tracks.filter(track => track.type === `subtitles`)
  
  return {
    audio: audioTracks.map(track => {
      return {
        name: track.properties[`track_name`],
        language: track.properties.language,
        codec: track.codec,
        channels: track.properties[`audio_channels`],
        ids: {
          mkvmerge: track.id,
        },
      }
    }),
    subs: subsTracks.map(track => {
      return {
        name: track.properties[`track_name`],
        language: track.properties.language,
        codec: track.codec,
        ids: {
          mkvmerge: track.id,
        },
      }
    })
  } 

}
module.exports.getTrackInfo = getTrackInfo

function getTrackType(trackInfo) {
  switch (trackInfo.type) {
    case `audio`:
      return `audio`
      break;
    case `subtitles`:
      return `subs`
      break;
  
    default:
      break;
  }
}

// matchTracksAndStreams(`/mnt/c/Users/Chaphasilor/Videos/BadBatchCopy.mkv`)
// .then(tracks => console.info(`tracks:`, tracks))
// .catch(err => console.error(`ERROR:`, err))
