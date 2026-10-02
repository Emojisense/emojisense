<?php
/**
 * Hosted emoji sets (Twemoji, Noto, Fluent): the same emoji on every device.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * Posts, excerpts and comments show the set's images (wp_staticize_emoji with the API as the
 * image source). WordPress's own emoji script uses the same source for emoji anywhere else on
 * the page that the browser cannot draw.
 */
class Emojisense_Emoji_Set {

	/**
	 * Hooks, only when a hosted set is chosen and the API is on.
	 */
	public function register() {
		add_action( 'init', array( $this, 'register_filters' ) );
	}

	/**
	 * Adds the filters (after the settings are readable).
	 */
	public function register_filters() {
		if ( 'native' === Emojisense_Settings::emoji_set() || is_admin() ) {
			return;
		}
		add_filter( 'emoji_url', array( $this, 'base_url' ) );
		add_filter( 'emoji_svg_url', array( $this, 'base_url' ) );
		add_filter( 'emoji_ext', array( $this, 'extension' ) );
		add_filter( 'emoji_svg_ext', array( $this, 'extension' ) );
		foreach ( array( 'the_content', 'the_excerpt', 'comment_text' ) as $hook ) {
			add_filter( $hook, array( $this, 'staticize' ), 50 );
		}
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_fallback' ) );
	}

	/**
	 * Image base URL of the set.
	 *
	 * @return string
	 */
	public function base_url() {
		return Emojisense_Settings::api_url() . '/v1/sets/' . Emojisense_Settings::emoji_set() . '/';
	}

	/**
	 * The hosted sets are SVG.
	 *
	 * @return string
	 */
	public function extension() {
		return '.svg';
	}

	/**
	 * Replaces emoji in HTML with the set's images.
	 *
	 * @param string $html Content.
	 * @return string
	 */
	public function staticize( $html ) {
		if ( is_feed() || ! is_string( $html ) || '' === $html ) {
			return $html;
		}
		return wp_staticize_emoji( $html );
	}

	/**
	 * A set may not draw every emoji (Fluent has no flags). A failed image shows its emoji as
	 * text instead of a broken image. Inline: it must run before the images fail.
	 */
	public function enqueue_fallback() {
		$prefix = esc_url_raw( $this->base_url() );
		$script = 'document.addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="IMG"&&t.alt&&t.src.indexOf(' . wp_json_encode( $prefix ) . ')===0){t.replaceWith(document.createTextNode(t.alt));}},true);';
		wp_register_script( 'emojisense-set-fallback', false, array(), EMOJISENSE_VERSION, array( 'in_footer' => false ) );
		wp_enqueue_script( 'emojisense-set-fallback' );
		wp_add_inline_script( 'emojisense-set-fallback', $script );
	}

	/**
	 * Image URL of one emoji in a hosted set.
	 *
	 * @param string $emoji Emoji.
	 * @param string $set   twemoji, noto or fluent.
	 * @return string
	 */
	public static function image_url( $emoji, $set ) {
		return Emojisense_Settings::api_url() . '/v1/sets/' . rawurlencode( $set ) . '/' . self::hexcode( $emoji ) . '.svg';
	}

	/**
	 * Code points of an emoji as uppercase hex joined by dashes (the API accepts it with or
	 * without U+FE0F).
	 *
	 * @param string $emoji Emoji (UTF-8).
	 * @return string
	 */
	public static function hexcode( $emoji ) {
		$chars = preg_split( '//u', $emoji, -1, PREG_SPLIT_NO_EMPTY );
		$hex   = array();
		foreach ( (array) $chars as $char ) {
			$hex[] = strtoupper( dechex( self::code_point( $char ) ) );
		}
		return implode( '-', $hex );
	}

	/**
	 * Code point of one UTF-8 character, without mbstring.
	 *
	 * @param string $char One character.
	 * @return int
	 */
	private static function code_point( $char ) {
		$bytes = array_values( (array) unpack( 'C*', $char ) );
		$count = count( $bytes );
		if ( 1 === $count ) {
			return $bytes[0];
		}
		if ( 2 === $count ) {
			return ( ( $bytes[0] & 0x1F ) << 6 ) | ( $bytes[1] & 0x3F );
		}
		if ( 3 === $count ) {
			return ( ( $bytes[0] & 0x0F ) << 12 ) | ( ( $bytes[1] & 0x3F ) << 6 ) | ( $bytes[2] & 0x3F );
		}
		return ( ( $bytes[0] & 0x07 ) << 18 ) | ( ( $bytes[1] & 0x3F ) << 12 ) | ( ( $bytes[2] & 0x3F ) << 6 ) | ( $bytes[3] & 0x3F );
	}
}
