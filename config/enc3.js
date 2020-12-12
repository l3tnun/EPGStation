const spawn = require('child_process').spawn;
const ffmpeg = process.env.FFMPEG;

const input = process.env.INPUT;
const output = process.env.OUTPUT;
const videoHeight = parseInt(process.env.VIDEORESOLUTION, 10);
const isDualMono = parseInt(process.env.AUDIOCOMPONENTTYPE, 10) == 2;
const args = ['-y'];

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

const child = spawn(ffmpeg, args);

let inputfileinfo = false;
let outputfileinfo = false;
let fileinfolog = '';

/**
 * エンコード進捗表示用に標準出力に進捗情報を吐き出す
 * 出力する JSON
 * {"type":"versioninfo","data":"ばーじょん"}
 * {"type":"logwithtag","tag":"[たぐ]","msg":"めっせーじ"}
 * {"type":"inputinfo","data":"入力ファイル情報"}
 * {"type":"outputinfo","data":"出力ファイル情報"}
 * {"type":"progress","data":{"frame":int,"fps":float,"q":float,"size":"0kB","time":"00:00:00.00","bitrate":"00000kbits/s","speed":"000x"}}
 */
child.stderr.on('data', data => {
    let strbyline = String(data).split('\n');
    for (let i = 0; i < strbyline.length; i++) {
        let str = strbyline[i].replace(/ \(\[.+?\)/, '');
        // console.log(strbyline[i]);
        if (str.startsWith('ffmpeg')) {
            console.log(JSON.stringify({ type: 'versioninfo', data: str.split('\n')[0].replace(/\r/g, '') }));
        } else if (str.startsWith('[')) {
            // [mpegts @ 00000154ad8b38c0] AAC bitstream not in ADTS format and extradata missing
            let tag = str.split('@')[0].trimEnd() + ']';
            let msg = str.split(']')[1].trim();
            //console.log(tag+" "+msg);
            console.log(JSON.stringify({ type: 'logwithtag', tag: tag, msg: msg }));
        } else if (str.startsWith('Input')) {
            inputfileinfo = true;
            fileinfolog += str + '\n';
        } else if (str.startsWith('Output')) {
            outputfileinfo = true;
            fileinfolog += str + '\n';
        } else if (str.startsWith('frame')) {
            // frame= 2847 fps=0.0 q=-1.0 Lsize=  216432kB time=00:01:35.64 bitrate=18537.1kbits/s speed= 222x
            const progress = {};
            let tmp = (str + ' ').match(/[A-z]*=[A-z,0-9,\s,.,\/,:,-]* /g);
            for (let j = 0; j < tmp.length; j++) {
                progress[tmp[j].split('=')[0]] = tmp[j].split('=')[1].replace(/\r/g, '').trim();
            }
            progress['frame'] = parseInt(progress['frame']);
            progress['fps'] = parseFloat(progress['fps']);
            progress['q'] = parseFloat(progress['q']);
            console.log(JSON.stringify({ type: 'progress', data: progress }));
        } else if (str.startsWith('  ') && (inputfileinfo || outputfileinfo)) {
            if (!str.startsWith('    Side data:') && !str.startsWith('      cpb:')) {
                fileinfolog += str;
            }
        } else {
            if (inputfileinfo) {
                console.log(
                    JSON.stringify({
                        type: 'inputinfo',
                        data: fileinfolog.replace(/\r\n/g, '\r').replace(/\r/g, '\n'),
                    }),
                );
                inputfileinfo = false;
                fileinfolog = '';
            } else if (outputfileinfo) {
                console.log(
                    JSON.stringify({
                        type: 'outputinfo',
                        data: fileinfolog.replace(/\r\n/g, '\r').replace(/\r/g, '\n'),
                    }),
                );
                outputfileinfo = false;
                fileinfolog = '';
            }
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
