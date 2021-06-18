const fs = require(`fs`)

const betterLogging = require(`better-logging`)
betterLogging(console, {
  format: ctx => `${ctx.type} ${ctx.msg}`,
  messageConstructionStrategy: betterLogging.MessageConstructionStrategy.FIRST,
})

const {Command, flags} = require(`@oclif/command`)
const inquirer = require(`inquirer`)
const cli = require(`cli-ux`).default
const ora = require('ora');
const ms = require(`ms`)

const { ALGORITHMS, calcOffset } = require(`../util/calc-offset`)
const { calculateOffset } = require(`../util/find-offset-new`)
const merge = require(`../util/merge-tracks`)
const tracks = require(`../util/tracks`)

class VideoSyncCommand extends Command {
  async run() {
    
    const { args, flags } = this.parse(VideoSyncCommand)

    console.logLevel = flags.verbose ? 4 : 2

    // console.warn(`args:`, args)
    // console.warn(`flags:`, flags)
    
    let prompt = Object.values(args).filter(x => x !== undefined).length < 2
    let answers

    if (prompt) {

      answers = await inquirer.prompt([
        {
          type: `input`,
          message: `Enter the destination file (where you want the synced tracks to be added to)`,
          name: `destination`,
          validate: function (answer) {
            if (!fs.existsSync(answer)) {
              return `The path you provided doesn't exist. Please provide a valid path to a video file.`;
            }
            return true;
          },
        },
        {
          type: `input`,
          message: `Enter the source file (that contains the new tracks to be synced over)`,
          name: `source`,
          validate: function (answer) {
            if (!fs.existsSync(answer)) {
              return `The path you provided doesn't exist. Please provide a valid path to a video file.`;
            }
            return true;
          },
        },
        {
          type: `input`,
          message: `Specify the output file (where the synced and muxed video gets written to)`,
          name: `output`,
          validate: (input) => {
            return input.length > 0 || `You need to specify a name!`
          },
          when: flags.output === undefined
        },
      ])
      
    } else {

      answers = {
        destination: args.destination,
        destinationOffset: args.destinationOffset,
        source: args.source,
        sourceOffset: args.sourceOffset,
        output: flags.output,
      }

    }
    
    let availableTracks = tracks.getTrackInfo(answers.source)
    
    let selectedTracks
    
    if (prompt) {

      selectedTracks = await inquirer.prompt([
        {
          type: `checkbox`,
          message: `Which audio tracks do you want copied and synced?`,
          name: `audio`,
          when: availableTracks.audio.length > 0 && flags.audioTracks === undefined,
          choices: availableTracks.audio.map(info => {
            return {
              name: `${info.name ? `"${info.name}"` : `*nameless*`} (${info.language}, ${info.codec}, ${info.channels} channel${info.channels.length > 1 ? `s`: ``}) - ID ${info.ids.mkvmerge}`,
              value: {
                type: `id`,
                value: info.ids.mkvmerge
              },
              checked: false,
              disabled: false,
            }
          }),
        },
        {
          type: `checkbox`,
          message: `Which subtitle tracks do you want copied and synced?`,
          name: `subs`,
          when: availableTracks.subs.length > 0 && flags.subsTracks === undefined,
          choices: availableTracks.subs.map(info => {
            return {
              name: `${info.name ? `"${info.name}"` : `*nameless*`} (${info.language}, ${info.codec}) - ID ${info.ids.mkvmerge}`,
              value: {
                type: `id`,
                value: info.ids.mkvmerge
              },
              checked: false,
              disabled: false,
            }
          }),
        },
      ])

    } else {

      let audioSelectors = availableTracks.audio.map(info => {
        return {
          type: `id`,
          value: info.ids.mkvmerge,
        }
      })
      let subsSelectors = availableTracks.subs.map(info => {
        return {
          type: `id`,
          value: info.ids.mkvmerge,
        }
      })

      if (flags.audioTracks) {
        
        let flatValuesAudio = flags.audioTracks?.flat()
        audioSelectors = flatValuesAudio?.map(x => {
  
          let parsed = parseInt(x, 10) // make sure the value only contains 0-9
          if (isNaN(parsed)) {
            if (x.slice(0, 1) === `-`) {
              // flag
              throw new Error(`The audioTracks flag requires at least one value!`)
            }
            // language
            return {
              type: `language`,
              value: x
            }
          } else {
            // ID
            return {
              type: `id`,
              value: parsed
            }
          }
        })

      }

      console.debug(`audioSelectors:`, audioSelectors)

      if (flags.subsTracks) {

        let flatValuesSubs = flags.subsTracks.flat()
        subsSelectors = flatValuesSubs.map(x => {
  
          let parsed = parseInt(x, 10) // make sure the value only contains 0-9
          if (isNaN(parsed)) {
            if (x.slice(0, 1) === `-`) {
              // flag
              throw new Error(`The subsTracks flag requires at least one value!`)
            }
            // language
            return {
              type: `language`,
              value: x
            }
          } else {
            // ID
            return {
              type: `id`,
              value: parsed
            }
          }
        })

      }

      console.debug(`subsSelectors:`, subsSelectors)

      selectedTracks = {
        audio: audioSelectors,
        subs: subsSelectors,
      }
      
    }
    
    // inquirer doesn't include a property if it wasn't included due to `when`
    selectedTracks = {
      audio: selectedTracks.audio ?? [],
      subs: selectedTracks.subs ?? [],
    }
      
    let videoOffset
    let confidence
    if (flags.forceOffset) {
      videoOffset = flags.offsetEstimate
      confidence = 1
    } else {
      let result
      
      if (flags.algorithm === `simple`) {
        result = await calcOffset(answers.destination, answers.source, {
          comparisonAlgorithm: ALGORITHMS.SSIM,
          iterations: flags.iterations,
          searchWidth: flags.searchWidth,
          searchResolution: flags.searchResolution,
          maxOffset: flags.maxOffset,
          offsetEstimate: flags.offsetEstimate,
          threshold: flags.threshold,
        })
      } else {
        result = await calculateOffset(answers.destination, answers.source, {
          maxOffset: flags.maxOffset * 1000,
          offsetEstimate: flags.offsetEstimate,
        })
      }

      videoOffset = result.videoOffset
      confidence = result.confidence
    }

    let continueWithMerging = answers.output !== undefined && (selectedTracks.audio.length > 0 || selectedTracks.subs.length > 0)

    if (continueWithMerging && (!flags.confirm && flags.algorithm === `ssim` && confidence < 0.6)) {
      continueWithMerging = (await inquirer.prompt([{
        type: `confirm`,
        name: `continue`,
        message: `Syncing confidence is very low (${confidence}). Do you want to continue?`,
      }])).continue
    }

    if (continueWithMerging) {
      try {
        await merge(answers.destination, answers.source, answers.output, videoOffset, selectedTracks)
      } catch (err) {
        console.error(err.message)
      }
    } else {
      const tempSpinner = ora(``).start();
      tempSpinner.info(`Nothing else to do.`)
    }
    
  }
}

VideoSyncCommand.description = `video-sync - a tool for automating the process of muxing additional audio tracks into videos
This tool requires the two input videos, the one where you want to add the additional tracks *to* (the destination video) and the one where you take the additional tracks *from* (the source video).
It then tries to find the exact same frame in both videos, in order to synchronize them (in case one of them is longer or shorter than the other).
It allows you to pick the audio and subtitle tracks you want to add to the destination and specify the output file.
There's an interactive mode (simply don't pass any arguments, flags work) and a CLI mode (pass the two arguments listed at the top).
`

VideoSyncCommand.args = [
  {
    name: `destination`,
    required: false,
    description: `video where tracks should be added to`,
  },
  {
    name: `source`,
    required: false,
    description: `video where the tracks are copied from`,
  },
]

VideoSyncCommand.flags = {
  version: flags.version(), // add --version flag to show CLI version
  help: flags.help({char: `h`}), // add --help flag to show CLI version
  output: flags.string({
    char: `o`,
    description: `output file path`,
    required: false, // if omitted, only the offset is printed
  }),
  confirm: flags.boolean({
    char: `y`,
    description: `automatically confirm missing tracks, low confidence scores and overwrite prompts
    `,
    required: false, // if omitted, only the offset is printed
    default: false,
  }),
  audioTracks: flags.string({
    char: `a`,
    multiple: true, // important to allow spaces in-between
    parse: x => x.split(`,`).map(y => y.trim()),
    description: `audio tracks to sync over to the destination video. comma-separated list of mkvmerge IDs or ISO 639-2 language tags (track matching that language will be synced). if omitted, all audio tracks will be synced.`,
    required: false, // if omitted, only the offset is printed
  }),
  subsTracks: flags.string({
    char: `s`,
    multiple: true, // important to allow spaces in-between
    parse: x => x.split(`,`).map(y => y.trim()),
    description: `subtitle tracks to sync over to the destination video. comma-separated list of mkvmerge IDs or ISO 639-2 language tags (track matching that language will be synced). if omitted, all subtitle tracks will be synced`,
    required: false, // if omitted, only the offset is printed
  }),
  algorithm: flags.enum({
    char: `g`,
    description: `search algorithm to use for video syncing`,
    options: [`simple`, `matching-scene`],
    default: `matching-scene`,
  }),
  iterations: flags.integer({
    char: `i`,
    description: `number of iterations to perform for video syncing (requires algorithm=simple)`,
    default: 2,
  }),
  searchWidth: flags.integer({
    char: `w`,
    description: `width of the search region (in seconds) for video syncing. the program will find the closest matching frame in this region, 'sourceOffset' being the center (requires algorithm=simple)`,
    default: 20,
  }),
  maxOffset: flags.integer({
    char: `m`,
    description: `maximum considered offset between the videos (in seconds) for video syncing.`,
    default: 120,
  }),
  offsetEstimate: flags.integer({
    char: `e`,
    description: `estimated offset between the two videos (in ms) for video syncing. positive values means that the source video is ahead of the destination video`,
    default: 0,
  }),
  forceOffset: flags.boolean({
    char: `f`,
    description: `use the estimated offset as the final offset, no synching`,
    default: false,
  }),
  threshold: flags.string({
    char: `t`,
    description: `minimum confidence threshold for video syncing. (requires algorithm=simple)`,
    parse: (input) => parseFloat(input),
    default: 0.6,
  }),
  searchResolution: flags.integer({
    char: `r`,
    description: `resolution of the search region (in frames) for video syncing. increases accuracy at the cost of longer runtime (requires algorithm=simple)`,
    default: 80,
  }),
  verbose: flags.boolean({
    char: `v`,
    description: `output additional logs`,
    default: false,
  }),
}

module.exports = VideoSyncCommand

function flatten(arr) {

}
