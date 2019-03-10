#!/bin/bash

mode=$1

if [ "$mode" = "" ]; then
    mode="main"
fi

function getHeight() {
    echo $VIDEORESOLUTION | sed -e "s/[^0-9]//g"
}

if [ `getHeight` -gt 720 ]; then
    $FFMPEG -dual_mono_mode $mode -i "$INPUT" -map 0:v:0 -map 0:a:0 -map 0:d:0 -map 0:d:1 -vf yadif -preset veryfast -c:v libx264 -crf 23 -f mp4 -s 1280x720 -c:a aac -ar 48000 -ab 192k -ac 2 "$OUTPUT"
else
    $FFMPEG -dual_mono_mode $mode -i "$INPUT" -map 0:v:0 -map 0:a:0 -map 0:d:0 -map 0:d:1 -vf yadif -preset veryfast -c:v libx264 -crf 23 -f mp4 -s 720x480 -c:a aac -ar 48000 -ab 128k -ac 2 "$OUTPUT"
fi

