const spawn = require('child_process').spawn;
const execFile = require('child_process').execFile;
const ffmpeg = process.env.FFMPEG;
const ffprobe = process.env.FFPROBE;

const input = process.env.INPUT;
const output = process.env.OUTPUT;
const videoHeight = parseInt(process.env.VIDEORESOLUTION, 10);
const isDualMono = parseInt(process.env.AUDIOCOMPONENTTYPE, 10) == 2;
const args = ['-y'];

/**
 * 動画長取得関数
 * @param {string} filePath ファイルパス
 * @return number 動画長を返す (秒)
 */
const getDuration = filePath => {
    return new Promise((resolve, reject) => {
        execFile(ffprobe, ['-v', '0', '-show_format', '-of', 'json', filePath], (err, stdout) => {
            if (err) {
                reject(err);

                return;
            }

            try {
                const result = JSON.parse(stdout);
                resolve(parseFloat(result.format.duration));
            } catch (err) {
                reject(err);
            }
        });
    });
};

// input 設定
Array.prototype.push.apply(args, ['-i', input]);

if (isDualMono) {
    Array.prototype.push.apply(args, [
        '-filter_complex',
        'channelsplit[FL][FR]',
        '-map 0:v',
        '-map [FL]',
        '-map [FR]',
        '-metadata:s:a:0 language=jpn',
        '-metadata:s:a:1 language=eng',
    ]);
    Array.prototype.push.apply(args, ['-c:a ac3', '-ar 48000', '-ab 256k']);
} else {
    // audio dataをコピー
    Array.prototype.push.apply(args, ['-c:a', 'aac']);
}

Array.prototype.push.apply(args, ['-ignore_unknown']);

// その他設定
Array.prototype.push.apply(args, ['-c:v', 'libx264', output]);

let str = '';
for (let i of args) {
    str += ` ${i}`;
}
// console.error(str);

(async () => {
    // 進捗計算のために動画の長さを取得
    const duration = await getDuration(input);

    const child = spawn(ffmpeg, args);

    let inputfileinfo = false;
    let outputfileinfo = false;
    let fileinfolog = '';

    /**
     * エンコード進捗表示用に標準出力に進捗情報を吐き出す
     * 出力する JSON
     * {"type":"progress","percent": 0.8, "log": "view log" }
     */
    child.stderr.on('data', data => {
        let strbyline = String(data).split('\n');
        for (let i = 0; i < strbyline.length; i++) {
            let str = strbyline[i].replace(/ \(\[.+?\)/, '');
            // console.log(strbyline[i]);
            if (str.startsWith('frame')) {
                // frame= 2847 fps=0.0 q=-1.0 Lsize=  216432kB time=00:01:35.64 bitrate=18537.1kbits/s speed= 222x
                const progress = {};
                let tmp = (str + ' ').match(/[A-z]*=[A-z,0-9,\s,.,\/,:,-]* /g);
                for (let j = 0; j < tmp.length; j++) {
                    progress[tmp[j].split('=')[0]] = tmp[j].split('=')[1].replace(/\r/g, '').trim();
                }
                progress['frame'] = parseInt(progress['frame']);
                progress['fps'] = parseFloat(progress['fps']);
                progress['q'] = parseFloat(progress['q']);

                let current = 0;
                const times = progress.time.split(':');
                for (let i = 0; i < times.length; i++) {
                    if (i == 0) {
                        current += parseFloat(times[i]) * 3600;
                    } else if (i == 1) {
                        current += parseFloat(times[i]) * 60;
                    } else if (i == 2) {
                        current += parseFloat(times[i]);
                    }
                }

                // 進捗率 1.0 で 100%
                const percent = current / duration;
                const log =
                    'frame= ' +
                    progress.frame +
                    ' fps=' +
                    progress.fps +
                    ' size=' +
                    progress.size +
                    ' time=' +
                    progress.time +
                    ' bitrate=' +
                    progress.bitrate +
                    ' speed=' +
                    progress.speed;

                console.log(JSON.stringify({ type: 'progress', percent: percent, log: log }));
            }
        }
    });

    child.on('error', err => {
        console.error(err);
        throw new Error(err);
    });

    process.on('SIGINT', () => {
        child.kill('SIGINT');
    });
})();
