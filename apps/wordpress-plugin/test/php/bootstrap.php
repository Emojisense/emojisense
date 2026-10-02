<?php
/**
 * PHPUnit bootstrap: the WordPress test library with the plugin loaded.
 *
 * Run inside wp-env (README.md), which provides the test library in WP_TESTS_DIR.
 *
 * @package Emojisense
 */

$emojisense_tests_dir = getenv( 'WP_TESTS_DIR' );
if ( ! $emojisense_tests_dir ) {
	$emojisense_tests_dir = rtrim( sys_get_temp_dir(), '/\\' ) . '/wordpress-tests-lib';
}

if ( ! file_exists( $emojisense_tests_dir . '/includes/functions.php' ) ) {
	echo "Could not find {$emojisense_tests_dir}/includes/functions.php. Run the tests with wp-env (see README.md)." . PHP_EOL; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	exit( 1 );
}

define( 'WP_TESTS_PHPUNIT_POLYFILLS_PATH', dirname( __DIR__, 2 ) . '/vendor/yoast/phpunit-polyfills' );

require_once $emojisense_tests_dir . '/includes/functions.php';

tests_add_filter(
	'muplugins_loaded',
	static function () {
		require dirname( __DIR__, 2 ) . '/emojisense.php';
	}
);

require $emojisense_tests_dir . '/includes/bootstrap.php';
