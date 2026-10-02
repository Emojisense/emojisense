<?php
/**
 * Script and style registration from the @wordpress/scripts build, and the configuration the
 * scripts read.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * Every bundle in build/ has an `<entry>.asset.php` with its dependencies and a content hash.
 */
class Emojisense_Assets {

	/**
	 * Registers a script (and its style, when the build has one) under `emojisense-<entry>`.
	 *
	 * @param string   $entry      Entry name in build/ (editor, classic, comments, reactions).
	 * @param string[] $extra_deps Script handles to add to the generated dependencies.
	 * @return string The script handle, or an empty string when the build is missing.
	 */
	public static function register( $entry, $extra_deps = array() ) {
		$handle = 'emojisense-' . $entry;
		if ( wp_script_is( $handle, 'registered' ) ) {
			return $handle;
		}
		$asset_file = EMOJISENSE_DIR . 'build/' . $entry . '.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return '';
		}
		$asset = require $asset_file;
		wp_register_script(
			$handle,
			EMOJISENSE_URL . 'build/' . $entry . '.js',
			array_merge( $asset['dependencies'], $extra_deps ),
			$asset['version'],
			array( 'in_footer' => true )
		);
		if ( in_array( 'wp-i18n', $asset['dependencies'], true ) ) {
			wp_set_script_translations( $handle, 'emojisense', EMOJISENSE_DIR . 'languages' );
		}
		if ( file_exists( EMOJISENSE_DIR . 'build/' . $entry . '.css' ) ) {
			wp_register_style( $handle, EMOJISENSE_URL . 'build/' . $entry . '.css', array(), $asset['version'] );
			// The build writes a mirrored <entry>-rtl.css for right-to-left languages.
			wp_style_add_data( $handle, 'rtl', 'replace' );
		}
		return $handle;
	}

	/**
	 * Enqueues a registered entry with its style.
	 *
	 * @param string $entry Entry name.
	 * @return string The script handle, or an empty string when the build is missing.
	 */
	public static function enqueue( $entry ) {
		$handle = self::register( $entry );
		if ( '' === $handle ) {
			return '';
		}
		wp_enqueue_script( $handle );
		if ( wp_style_is( $handle, 'registered' ) ) {
			wp_enqueue_style( $handle );
		}
		return $handle;
	}

	/**
	 * Adds `window.emojisenseConfig` before a script.
	 *
	 * @param string              $handle Script handle.
	 * @param array<string,mixed> $extra  Values for this script only.
	 */
	public static function add_config( $handle, $extra = array() ) {
		$config = array_merge( self::client_config(), $extra );
		wp_add_inline_script( $handle, 'window.emojisenseConfig = ' . wp_json_encode( $config ) . ';', 'before' );
	}

	/**
	 * What the pickers and the autocompleter need. The API address and key are only included
	 * when search by meaning is on, so the browser never calls the API otherwise.
	 *
	 * @return array<string,mixed>
	 */
	public static function client_config() {
		$semantic = Emojisense_Settings::semantic_enabled();
		$locale   = Emojisense_Settings::locale();
		$culture  = (bool) Emojisense_Settings::value( 'culture' );
		$config   = array(
			'packUrl'    => EMOJISENSE_URL . 'packs/' . EMOJISENSE_PACK_VERSION,
			'locale'     => $locale,
			'cultureUrl' => '',
			'endpoint'   => '',
			'key'        => '',
			// The picker draws a hosted set from the API address, which it gets only with
			// search by meaning on. Without it, the picker draws native emoji.
			'emojiSet'   => $semantic ? Emojisense_Settings::emoji_set() : 'native',
		);
		if ( $culture ) {
			$config['cultureUrl'] = Emojisense_Settings::api_enabled()
				? Emojisense_Settings::api_url() . '/v1/culture/' . EMOJISENSE_PACK_VERSION
				: EMOJISENSE_URL . 'packs/culture/' . EMOJISENSE_PACK_VERSION;
		}
		if ( $semantic ) {
			$config['endpoint'] = Emojisense_Settings::api_url();
			$config['key']      = Emojisense_Settings::publishable_key();
		}
		return $config;
	}
}
