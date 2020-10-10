/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';

const gulp = require('gulp');
const del = require('del');
const plumber = require('gulp-plumber');
const eslint = require('gulp-eslint');
const typescript = require('gulp-typescript');
const sourcemaps = require('gulp-sourcemaps');
// const minimist = require('minimist');

const src = ['./src/**/*.ts'];
const dist = './dist';
const tsconfig = require('./src/tsconfig.json');

/**
 * 引数
 * NODE_ENVに指定がなければ開発モードをデフォルトにする
 */
/*
 const knownOptions = {
    string: 'env',
    default: { env: process.env.NODE_ENV || 'development' },
};
const options = minimist(process.argv.slice(2), knownOptions);
const isProduction = options.env === 'production';
*/

// clean
gulp.task('clean', () => {
    return del([dist]);
});

// eslint
gulp.task('eslint', () => {
    return gulp
        .src(src)
        .pipe(eslint({ useEslintrc: true }))
        .pipe(eslint.format())
        .pipe(eslint.failAfterError());
});

// build
gulp.task(
    'build',
    gulp.series('clean', 'eslint', () => {
        return gulp
            .src(src)
            .pipe(plumber())
            .pipe(sourcemaps.init())
            .pipe(typescript(tsconfig.compilerOptions))
            .pipe(sourcemaps.write('./'))
            .pipe(gulp.dest(dist));
    }),
);

// watch
gulp.task(
    'watch',
    gulp.series('build', () => {
        gulp.watch(src, gulp.task('build'));
    }),
);

gulp.task('default', gulp.series('watch'));
