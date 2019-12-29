'use strict';

const fs = require('fs');
const path = require('path');
const gulp = require('gulp');
const del = require('del');
const plumber = require('gulp-plumber');
const tslint = require('gulp-tslint');
const typescript = require('gulp-typescript');
const sourcemaps = require('gulp-sourcemaps');
const minimist = require('minimist');
const webpackStream = require('webpack-stream');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
const sass = require('gulp-dart-sass');
const concat = require('gulp-concat');
const cleanCSS = require('gulp-clean-css');

const config = {
    server : {
        src: [
            './src/server/**/*.ts'
        ],
        dst: './dist/server',
        options: {
            module: 'commonjs',
            target: 'ES6',
            strictNullChecks: true,
            noImplicitAny: true,
            noImplicitReturns: true,
            noImplicitThis: true,
            noUnusedParameters: true,
            noUnusedLocals: true,
            noFallthroughCasesInSwitch: true,
            suppressImplicitAnyIndexErrors: true,
            alwaysStrict: true
        }
    },
    client: {
        src: [ './src/client/**/*.ts' ],
        dst: './dist/client',
        css: {
            src: [ './src/css/**/*.sass' ],
            dst: './dist/css',
        },
    }
};

/**
 * 引数
 * NODE_ENVに指定がなければ開発モードをデフォルトにする
 */
const knownOptions = {
  string: 'env',
  default: { env: process.env.NODE_ENV || 'development' }
};
const options = minimist(process.argv.slice(2), knownOptions);
const isProduction = options.env === 'production';

// webpack 設定
const webpackConfig = {
    mode: options.env,
    output: {
        filename: 'app.js'
    },
    resolve: {
        extensions: ['.ts', '.webpack.js', '.web.js', '.js']
    },
    cache: true,
    module: {
        rules: [
            { test: /\.ts$/, loader: 'ts-loader' }
        ]
    },
    plugins: [
        new webpack.optimize.OccurrenceOrderPlugin()
    ],
    performance: {
        hints: false
    }
}

if (isProduction) {
    webpackConfig.optimization = {
        minimizer: [new TerserPlugin()]
    };
} else {
    // enable source map
    webpackConfig.devtool = 'source-map';
}

// server
gulp.task('clean-server', () => {
    return del([config.server.dst]);
})

gulp.task('tslint-server', () => {
    return gulp
        .src(config.server.src)
        .pipe(tslint())
        .pipe(tslint.report({
            emitError: false,
            summarizeFailureOutput: true
        }));
});

gulp.task('build-server', gulp.series('clean-server', 'tslint-server', () => {
    return gulp.src(config.server.src)
        .pipe(plumber())
        .pipe(sourcemaps.init())
        .pipe(typescript(config.server.options))
        .pipe(sourcemaps.write('./'))
        .pipe(gulp.dest(config.server.dst));
}));

// client
gulp.task('clean-client', () => {
    return del([config.client.dst]);
})

gulp.task('tslint-client', () => {
    return gulp
        .src(config.client.src)
        .pipe(tslint())
        .pipe(tslint.report({
            emitError: false,
            summarizeFailureOutput: true
        }));
});

gulp.task('build-client', gulp.series('clean-client', 'tslint-client', () => {
    return gulp.src(config.client.src)
        .pipe(plumber())
        .pipe(webpackStream(webpackConfig, webpack))
        .pipe(gulp.dest(config.client.dst))
        .on('error', (error) => {
            console.error(error);
        });
}));

gulp.task('clean-client-css', () => {
    return del([config.client.css.dst]);
});

gulp.task('client-css-build', () => {
    let result = gulp.src(config.client.css.src)
        .pipe(plumber())
        .pipe(sourcemaps.init())
        .pipe(sass())
        .pipe(concat('style.css'))

    if (isProduction) {
        return result
            .pipe(cleanCSS())
            .pipe(gulp.dest(config.client.css.dst));
    } else {
        return result
            .pipe(sourcemaps.write())
            .pipe(gulp.dest(config.client.css.dst));
    }
});

// clean
gulp.task('clean', gulp.series('clean-server', 'clean-client', 'clean-client-css'));

// build
gulp.task('build', gulp.series('build-server', 'build-client', 'client-css-build'));

gulp.task('watch', gulp.series(
    'build',
    () => {
        gulp.watch(config.server.src, gulp.task('build-server'));
        gulp.watch(config.client.src, gulp.task('build-client'));
        gulp.watch(config.client.css.src, gulp.task('client-css-build'));
    })
);

gulp.task('default', gulp.series('watch'));

