const spawn = require('child_process').spawn;
const ffmpeg = process.env.FFMPEG;

let mode = 'main';
if(process.argv.length >= 3 && (process.argv[2] === 'main' || process.argv[2] === 'sub')) {
    mode = process.argv[2];
}

const input = process.env.INPUT;
const output = process.env.OUTPUT;
const videoHeight = parseInt(process.env.VIDEORESOLUTION, 10);

let args;
if(videoHeight > 720) {
    args = ['-y', '-dual_mono_mode', mode, '-i', input, '-map', '0', '-ignore_unknown', '-vf', 'yadif', '-preset', 'veryfast', '-aspect', '16:9', '-c:v', 'libx264', '-crf', '23', '-f', 'mp4', '-s', '1280x720', '-c:a', 'aac', '-ar', '48000', '-ab', '192k', '-ac', '2', output];
} else {
    args = ['-y', '-dual_mono_mode', mode, '-i', input, '-map', '0', '-ignore_unknown', '-vf', 'yadif', '-preset', 'veryfast', '-aspect', '16:9', '-c:v', 'libx264', '-crf', '23', '-f', 'mp4', '-c:a', 'aac', '-ar', '48000', '-ab', '192k', '-ac', '2', output];
}

console.error(args);

let child = spawn(ffmpeg, args);

child.stderr.on('data', (data) => { console.error(String(data)); });

child.on('error', (err) => {
    console.error(err);
    throw new Error(err);
});

process.on('SIGINT', () => {
    child.kill('SIGINT');
});

