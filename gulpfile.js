const gulp = require('gulp');
const ts = require('gulp-typescript');
const jasmine = require('gulp-jasmine');
const clean = require('gulp-clean');
const runSequence = require('run-sequence');
var exec = require('child_process').exec;

gulp.task('build-type-definitions', function() {
	const merge = require('merge2');
	const tsProject = ts.createProject('tsconfig.json');

	var tsResult = tsProject.src()
		.pipe(tsProject());

	return merge([
		tsResult.dts.pipe(gulp.dest('./definitions')),
		// tsResult.js.pipe(gulp.dest(tsProject.config.compilerOptions.outDir))

	]);
});

gulp.task('clean', function() {
	return gulp.src('dist', {
		read: false
	}).pipe(clean());
});

gulp.task('build-project', function(cb) {
	exec('./node_modules/typescript/bin/tsc -p ./', function(err, stdout, stderr) {
		console.log(stdout);
		console.log(stderr);
		cb(err);
	});
});

gulp.task('build-bundle', function(cb) {
	exec('script/browserfy.sh', function(err, stdout, stderr) {
		console.log(stdout);
		console.log(stderr);
		cb(err);
	});
});

gulp.task('test:run', function() {
	return gulp.src('dist/spec/*.spec.js')
		.pipe(jasmine())
});

gulp.task('test', [], function(next) {
	runSequence('clean', 'build-type-definitions', 'build-project', 'build-bundle', 'test:run', next);
});

gulp.task('default', [], function(cb) {
	runSequence('clean', 'build-type-definitions', 'build-project', 'build-bundle', cb);
});