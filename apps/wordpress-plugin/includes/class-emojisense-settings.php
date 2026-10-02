<?php
/**
 * Settings: the option schema, defaults, sanitization and the derived values the rest of the
 * plugin reads.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * One option, `emojisense_settings`, holds every setting. Everything that reaches the network is
 * behind `api_enabled`, which is off by default: a fresh install sends nothing anywhere.
 */
class Emojisense_Settings {

	const OPTION = 'emojisense_settings';

	const DEFAULT_API_URL = 'https://api.emojisense.com';

	/** Pack locales of the bundled data (packs/<version>/pack.<locale>.json). */
	const LOCALES = array( 'en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'ru', 'id', 'tr' );

	const EMOJI_SETS = array( 'native', 'twemoji', 'noto', 'fluent' );

	/** The most reactions one post shows. */
	const MAX_REACTIONS = 8;

	/**
	 * Settings of a fresh install.
	 *
	 * @return array<string, mixed>
	 */
	public static function defaults() {
		return array(
			'api_enabled'          => false,
			'publishable_key'      => '',
			'api_url'              => self::DEFAULT_API_URL,
			'semantic_search'      => true,
			'emoji_set'            => 'native',
			'suggest_reactions'    => true,
			'locale'               => 'auto',
			'culture'              => true,
			'editor_autocomplete'  => true,
			'reactions_post_types' => array(),
			'default_reactions'    => array( '👍', '❤️', '😂', '😮', '😢', '🎉' ),
			'comment_picker'       => false,
		);
	}

	/**
	 * The stored settings over the defaults.
	 *
	 * @return array<string, mixed>
	 */
	public static function get() {
		$stored = get_option( self::OPTION, array() );
		return array_merge( self::defaults(), is_array( $stored ) ? $stored : array() );
	}

	/**
	 * One setting.
	 *
	 * @param string $name Setting name (a key of defaults()).
	 * @return mixed
	 */
	public static function value( $name ) {
		$settings = self::get();
		return isset( $settings[ $name ] ) ? $settings[ $name ] : null;
	}

	/**
	 * Whether the admin allowed calls to the Emojisense API.
	 *
	 * @return bool
	 */
	public static function api_enabled() {
		return (bool) self::value( 'api_enabled' ) && '' !== self::api_url();
	}

	/**
	 * Search by meaning in the editors and the comment picker.
	 *
	 * @return bool
	 */
	public static function semantic_enabled() {
		return self::api_enabled() && (bool) self::value( 'semantic_search' );
	}

	/**
	 * Reaction suggestions from the post text.
	 *
	 * @return bool
	 */
	public static function suggestions_enabled() {
		return self::api_enabled() && (bool) self::value( 'suggest_reactions' );
	}

	/**
	 * The hosted emoji set, or "native" when the API is off (the images come from the API).
	 *
	 * @return string
	 */
	public static function emoji_set() {
		$set = (string) self::value( 'emoji_set' );
		return self::api_enabled() && in_array( $set, self::EMOJI_SETS, true ) ? $set : 'native';
	}

	/**
	 * Base URL of the API, without a trailing slash.
	 *
	 * @return string
	 */
	public static function api_url() {
		return untrailingslashit( (string) self::value( 'api_url' ) );
	}

	/**
	 * The publishable key, or an empty string.
	 *
	 * @return string
	 */
	public static function publishable_key() {
		return (string) self::value( 'publishable_key' );
	}

	/**
	 * The pack locale: the setting, or the site language when it is "auto".
	 *
	 * @return string
	 */
	public static function locale() {
		$locale = (string) self::value( 'locale' );
		if ( in_array( $locale, self::LOCALES, true ) ) {
			return $locale;
		}
		return self::pack_locale( get_locale() );
	}

	/**
	 * Maps a WordPress locale (pt_BR, zh_CN, tr_TR) to a pack locale (pt, zh, tr); English when
	 * there is no pack for the language.
	 *
	 * @param string $wp_locale WordPress locale.
	 * @return string
	 */
	public static function pack_locale( $wp_locale ) {
		$language = strtolower( (string) strtok( (string) $wp_locale, '_-' ) );
		return in_array( $language, self::LOCALES, true ) ? $language : 'en';
	}

	/**
	 * Post types that show reactions.
	 *
	 * @return string[]
	 */
	public static function reaction_post_types() {
		$types = self::value( 'reactions_post_types' );
		return is_array( $types ) ? array_values( array_map( 'strval', $types ) ) : array();
	}

	/**
	 * Whether posts of this type show reactions.
	 *
	 * @param string $post_type Post type name.
	 * @return bool
	 */
	public static function reactions_enabled_for( $post_type ) {
		return in_array( $post_type, self::reaction_post_types(), true );
	}

	/**
	 * The reactions a post shows when its author chose none and there is no suggestion.
	 *
	 * @return string[]
	 */
	public static function default_reactions() {
		$list = self::parse_emoji_list( self::value( 'default_reactions' ) );
		return $list ? $list : self::defaults()['default_reactions'];
	}

	/**
	 * Origin (scheme, host and port) of a URL, as browsers send it in the Origin header.
	 *
	 * @param string $url URL.
	 * @return string Empty when the URL has no scheme or host.
	 */
	public static function origin_of( $url ) {
		$parts = wp_parse_url( $url );
		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return '';
		}
		$origin = strtolower( $parts['scheme'] . '://' . $parts['host'] );
		return isset( $parts['port'] ) ? $origin . ':' . (int) $parts['port'] : $origin;
	}

	/**
	 * Origins that must be in the key's allowed origins: the site, and the admin when it differs.
	 *
	 * @return string[]
	 */
	public static function site_origins() {
		return array_values( array_unique( array_filter( array( self::origin_of( home_url() ), self::origin_of( admin_url() ) ) ) ) );
	}

	/**
	 * Splits text (or a list) into at most `$max` distinct emoji. Anything that is not an emoji is
	 * dropped, so the result is safe to store and to compare with REST input.
	 *
	 * @param mixed $value Text with emoji separated by spaces or commas, or an array of emoji.
	 * @param int   $max   Most emoji to keep.
	 * @return string[]
	 */
	public static function parse_emoji_list( $value, $max = self::MAX_REACTIONS ) {
		if ( is_array( $value ) ) {
			$tokens = $value;
		} elseif ( is_string( $value ) ) {
			$tokens = preg_split( '/[\s,]+/u', $value, -1, PREG_SPLIT_NO_EMPTY );
		} else {
			$tokens = array();
		}
		$list = array();
		foreach ( (array) $tokens as $token ) {
			if ( ! is_string( $token ) ) {
				continue;
			}
			$token = trim( $token );
			if ( self::is_emoji( $token ) && ! in_array( $token, $list, true ) ) {
				$list[] = $token;
			}
			if ( count( $list ) >= $max ) {
				break;
			}
		}
		return $list;
	}

	/**
	 * Whether a string is one emoji (or a short emoji sequence): pictographic code points with
	 * their joiners, variation selectors, skin tones, keycaps and tags, nothing else.
	 *
	 * @param string $text Candidate.
	 * @return bool
	 */
	public static function is_emoji( $text ) {
		if ( '' === $text || strlen( $text ) > 64 ) {
			return false;
		}
		$pictographic = '\x{00A9}\x{00AE}\x{203C}\x{2049}\x{2122}\x{2139}\x{2194}-\x{21AA}\x{231A}-\x{23FF}\x{24C2}\x{25AA}-\x{25FE}\x{2600}-\x{27BF}\x{2934}\x{2935}\x{2B05}-\x{2B55}\x{3030}\x{303D}\x{3297}\x{3299}\x{1F000}-\x{1FAFF}';
		$modifiers    = '\x{200D}\x{20E3}\x{FE0F}\x{1F3FB}-\x{1F3FF}\x{E0020}-\x{E007F}#*0-9';
		// D: `$` must not accept a trailing newline.
		if ( ! preg_match( '/^[' . $pictographic . $modifiers . ']+$/uD', $text ) ) {
			return false;
		}
		// A pictograph, or a keycap (1️⃣ is a digit, U+FE0F and U+20E3).
		return 1 === preg_match( '/[' . $pictographic . '\x{20E3}]/u', $text );
	}

	/**
	 * The `sanitize_callback` of the option. Idempotent: WordPress may run it twice on the first
	 * save, and on values that were already sanitized.
	 *
	 * @param mixed $input Raw form input, or a stored value.
	 * @return array<string, mixed>
	 */
	public static function sanitize( $input ) {
		$input    = is_array( $input ) ? $input : array();
		$current  = self::get();
		$defaults = self::defaults();
		$clean    = array();

		foreach ( array( 'api_enabled', 'semantic_search', 'suggest_reactions', 'culture', 'editor_autocomplete', 'comment_picker' ) as $flag ) {
			$clean[ $flag ] = ! empty( $input[ $flag ] );
		}

		// Validated against a strict pattern instead of sanitized: anything else keeps the old key.
		$key = isset( $input['publishable_key'] ) ? trim( (string) $input['publishable_key'] ) : '';
		if ( '' === $key || self::is_publishable_key( $key ) ) {
			$clean['publishable_key'] = $key;
		} else {
			$clean['publishable_key'] = $current['publishable_key'];
			$message                  = 0 === strpos( $key, 'sk_' )
				? __( 'That is a secret key. Secret keys must never be put on a website. Create a publishable key (pk_live_…) instead, and revoke the secret key if it was shared.', 'emojisense' )
				: __( 'The publishable key must start with pk_live_. The key was not changed.', 'emojisense' );
			self::report_error( 'emojisense_publishable_key', $message );
		}

		$api_url = isset( $input['api_url'] ) ? trim( (string) $input['api_url'] ) : '';
		if ( '' === $api_url ) {
			$clean['api_url'] = self::DEFAULT_API_URL;
		} elseif ( self::is_valid_api_url( $api_url ) ) {
			$clean['api_url'] = untrailingslashit( esc_url_raw( $api_url, array( 'https', 'http' ) ) );
		} else {
			$clean['api_url'] = $current['api_url'];
			self::report_error( 'emojisense_api_url', __( 'The API address must start with https:// (http:// only for localhost). The address was not changed.', 'emojisense' ) );
		}

		$set                = isset( $input['emoji_set'] ) ? (string) $input['emoji_set'] : '';
		$clean['emoji_set'] = in_array( $set, self::EMOJI_SETS, true ) ? $set : $defaults['emoji_set'];

		$locale          = isset( $input['locale'] ) ? (string) $input['locale'] : '';
		$clean['locale'] = 'auto' === $locale || in_array( $locale, self::LOCALES, true ) ? $locale : 'auto';

		$public_types                  = array_keys( get_post_types( array( 'public' => true ) ) );
		$types                         = isset( $input['reactions_post_types'] ) && is_array( $input['reactions_post_types'] ) ? $input['reactions_post_types'] : array();
		$clean['reactions_post_types'] = array_values( array_intersect( array_map( 'sanitize_key', $types ), $public_types ) );

		$reactions                  = isset( $input['default_reactions'] ) ? self::parse_emoji_list( $input['default_reactions'] ) : array();
		$clean['default_reactions'] = $reactions ? $reactions : $defaults['default_reactions'];

		return $clean;
	}

	/**
	 * A publishable key: `pk_live_` (or `pk_test_`) and 8 to 128 letters and digits.
	 *
	 * @param string $key Candidate key.
	 * @return bool
	 */
	public static function is_publishable_key( $key ) {
		return 1 === preg_match( '/^pk_(live|test)_[A-Za-z0-9]{8,128}$/D', $key );
	}

	/**
	 * HTTPS, or HTTP for a local development API.
	 *
	 * @param string $url Candidate URL.
	 * @return bool
	 */
	public static function is_valid_api_url( $url ) {
		$parts = wp_parse_url( $url );
		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['query'] ) ) {
			return false;
		}
		if ( 'https' === $parts['scheme'] ) {
			return true;
		}
		return 'http' === $parts['scheme'] && in_array( $parts['host'], array( 'localhost', '127.0.0.1', '[::1]' ), true );
	}

	/**
	 * A settings error, when the Settings API is loaded (it is not in REST or CLI updates).
	 *
	 * @param string $code    Error code.
	 * @param string $message Message for the admin.
	 */
	private static function report_error( $code, $message ) {
		if ( function_exists( 'add_settings_error' ) ) {
			add_settings_error( self::OPTION, $code, $message );
		}
	}
}
