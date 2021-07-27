const { exec } = require(`child_process`)
const probe = require(`node-ffprobe`)
const cli = require(`cli-ux`).default
const ora = require('ora');
const chalk = require('chalk');
const ms = require(`ms`)

const tracks = require(`./tracks`)

module.exports = function(video1, video2, output, offset, tracksToSync) {
  return new Promise(async (resolve, reject) => {
  
    let spinner = ora(`Figuring out offsets for selected tracks...`).start();
    // cli.action.start(`Figuring out offsets for audio tracks`)
    
    let matchedTracks
    try {
      matchedTracks = await tracks.matchTracksAndStreams(video2)
    } catch (err) {
      throw new Error(err)
    }

    let trackIdsToSync = {
      audio: tracksToSync.audio.map(track => {
        if (track.type === `language`) {
          return matchedTracks.filter(x => x.infos.type === `audio`).filter(x => (x.infos.language === track.value || x.infos.languageIetf === track.value)).map(x => x.ids.mkvmerge)
        } else {
          return track.value
        }
      }).flat(),
      subs: tracksToSync.subs.map(track => {
        if (track.type === `language`) {
          return matchedTracks.filter(x => x.infos.type === `subs`).filter(x => (x.infos.language === track.value || x.infos.languageIetf === track.value)).map(x => x.ids.mkvmerge)
        } else {
          return track.value
        }
      }).flat(),
    }

    console.log(`trackIdsToSync:`, trackIdsToSync)
    if (trackIdsToSync.audio.length + trackIdsToSync.subs.length === 0) {
      // nothing to do
      spinner.warn(`No tracks to sync!`)
      return resolve();
    }
    
    let vidData = await probe(video2)
    const videoOffset = Number(vidData.streams.find(stream => stream.codec_type === `video`)?.start_time || 0.0)*1000
    let finalOffsets = [...trackIdsToSync.audio, ...trackIdsToSync.subs].map(trackId => {
      let foundTrack =  matchedTracks.find(track => track.ids.mkvmerge === trackId)
      let streamIndex = foundTrack.ids.ffprobe
      return {
        id: trackId,
        offset: Number(offset) + Number(vidData.streams.find(stream => stream.index === streamIndex).start_time)*1000 + videoOffset
      }
    })

    spinner.succeed(`Final offsets calculated.`)
    console.log(`Final offsets are:`, finalOffsets)

    let trackIdsAudioString = trackIdsToSync.audio.length > 0 ? trackIdsToSync.audio.reduce((sum, cur, index) => {
      return `${sum}${index > 0 ? `,` : ``}${cur}`
    }, `-a `) : ``
    let trackIdsSubsString = trackIdsToSync.subs.length > 0 ? trackIdsToSync.subs.reduce((sum, cur, index) => {
      return `${sum}${index > 0 ? `,` : ``}${cur}`
    }, `-s `) : ``
    let syncString = finalOffsets.reduce((sum, cur) => {
      return `${sum} --sync ${cur.id}:${cur.offset}`
    }, ``)

    // cli.action.start(`Muxing output video`)

    let mergeCommand = `mkvmerge -o "${output}" "${video1}" -D ${trackIdsAudioString} ${trackIdsSubsString} ${syncString} "${video2}"`
    console.log(mergeCommand)
    let merger = exec(mergeCommand)

    merger.stdout.setEncoding(`utf8`)
    merger.stderr.setEncoding(`utf8`)

    const startTime = Date.now()
    const simpleBar = cli.progress({
      format: `Muxing output video [${chalk.green('{bar}')}] {percentage} % | ETA: {eta_formatted}`,
      etaBuffer: 7,
      clearOnComplete: true,
    })
    simpleBar.start(100, 0);

    merger.stdout.on('data', (data) => {
      console.debug(`stdout: ${data}`);
      let tester = /Progress: (\d+)%/
      if (tester.test(data)) {
        simpleBar.update(Number(data.match(tester)[1]));
      }
    });
    merger.stderr.on('data', (data) => {
      console.warn(`Error from mkvmerge: ${data}`);
    });

    merger.on('close', (code, signal) => {

      simpleBar.stop()

      if (!code && code !== 0) {
        return reject(new Error(`mkvmerge was killed by '${signal}'`));
      }
      if (code === 2) {
        return reject(new Error(`Muxing FAILED! mkvmerge exited with code '${code}'`));
      }

      if (code === 1 && console.logLevel < 4) {
        // warnings were logged
        console.warn(`Some warnings occurred during muxing. For more info, try again with the '-v' flag.`)
      }

      const tempSpinner = ora(``).start();
      tempSpinner.succeed(`Successfully muxed output video in ${ms(Date.now() - startTime)}.`)

      return resolve()

    })

  })
}

