# video-sync

A tool for automating the process of muxing additional audio tracks into videos

## Usage

```sh-session
video-sync [DESTINATION] [SOURCE] <flags>
```

## Description

This tool requires the two input videos, the one where you want to add the additional tracks *to* (the destination video) and the one where you take the additional tracks *from* (the source video).  
It then tries to find the exact same frame in both videos, in order to synchronize them (in case one of them is longer or shorter than the other).  
It allows you to pick the audio and subtitle tracks you want to add to the destination and specify the output file.

There's an interactive mode (simply don't pass any arguments, flags are fine) and a CLI mode (pass the two arguments listed at the top).

## Examples

```sh-session
$ video-sync # interactive mode
...
$ video-sync video1 video2 -o output # CLI mode
...
$ video-sync -a 0,en -s 2,ger # sync the audio track with mkvmerge ID `0` and all additional english audio tracks, and also the subtitle track with ID `2` and all additional german subtitle tracks
...
$ video-sync -e 300 -f # don't sync the videos, instead use the offset estimate (source `300` ms ahead of destination) as the final/forced offset
...
$ video-sync -h # help page
...
```

## Arguments

- `DESTINATION` video where tracks should be added to
- `SOURCE` video where the tracks are copied from

## Options

- `-o, --output=<path>` output file path

- `-a, --audioTracks=<list>` audio tracks to sync over to the destination video. comma-separated list of mkvmerge IDs or ISO 639-2 language tags (track matching that language will be synced). if omitted, all audio tracks will be synced.

- `-s, --subsTracks=<list>` subtitle tracks to sync over to the destination video. comma-separated list of mkvmerge IDs or ISO 639-2 language tags (track matching that language will be synced). if omitted, all subtitle tracks will be synced

- `-g, --algorithm=<simple|matching-scene>` [default: matching-scene] search algorithm to use for video syncing

- `-e, --offsetEstimate=<number>` estimated offset between the two videos (in ms) for video syncing. positive values means that the source video is ahead of the destination video

- `-f, --forceOffset` use the estimated offset as the final offset, no synching

- `-m, --maxOffset=<number>` [default: 120] maximum considered offset between the videos (in seconds) for video syncing.

- `--searchIncrements=<number>` [default: 3] maximum area (video duration, in seconds) to search for the next scene in any direction (forward/backward) before searching in the other direction (requires algorithm=matching-scene)
- `--sceneSearchDuration=<number>` [default: 300] maximum area (video duration, in seconds) to search for any "abrupt" scene change in the destination video before aborting (requires algorithm=matching-scene)
- `-x, --exclusiveDirection=<ahead|behind>` only search the matching frame offset in one direction. 'ahead' means that the source video scene comes *before* the destination video scene. (requires algorithm=matching-scene)

- `-i, --iterations=<number>` [default: 2] number of iterations to perform for video syncing (requires algorithm=simple)
- `-t, --threshold=<number>` [default: 0.6] minimum confidence threshold for video syncing. (requires algorithm=simple)
- `-r, --searchResolution=<number>` [default: 80] resolution of the search region (in frames) for video syncing. increases accuracy at the cost of longer runtime (requires algorithm=simple)

- `-y, --confirm` automatically confirm missing tracks, low confidence scores, warped videos and overwrite prompts

- `-v, --verbose` output additional logs

- `-h, --help` show CLI help

- `--version` show CLI version
