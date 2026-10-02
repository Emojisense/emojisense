<?php
/**
 * Server-side calls to the Emojisense API. Only made when the admin turned the API on.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * The publishable key goes in the query (as browsers send it) with the site's Origin, so the
 * key's allowed origins work the same for the server and for the browser.
 */
class Emojisense_Api_Client {

	/** Seconds to wait for the API. Publishing a post must never hang on it. */
	const TIMEOUT = 5;

	/** The API reads at most this many characters of a message. */
	const MAX_TEXT = 256;

	/**
	 * Reaction suggestions for a text (POST /v1/suggest-reactions).
	 *
	 * @param string $text   Post title and text, as plain text.
	 * @param string $locale Pack locale.
	 * @param int    $limit  Most emoji to return.
	 * @return string[]|WP_Error Emoji, best first.
	 */
	public static function suggest_reactions( $text, $locale, $limit = 6 ) {
		if ( ! Emojisense_Settings::api_enabled() ) {
			return new WP_Error( 'emojisense_api_off', __( 'The Emojisense API is turned off in Settings → Emojisense.', 'emojisense' ) );
		}
		$text = self::plain_text( $text );
		if ( '' === $text ) {
			return new WP_Error( 'emojisense_empty_text', __( 'The post has no text to suggest reactions from yet.', 'emojisense' ) );
		}
		$body = self::request(
			'POST',
			'/v1/suggest-reactions',
			array(),
			array(
				'text'   => $text,
				'locale' => $locale,
				'limit'  => max( 1, min( 24, (int) $limit ) ),
			)
		);
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		$emoji = array();
		foreach ( isset( $body['results'] ) && is_array( $body['results'] ) ? $body['results'] : array() as $result ) {
			if ( is_array( $result ) && isset( $result['emoji'] ) && is_string( $result['emoji'] ) ) {
				$emoji[] = $result['emoji'];
			}
		}
		return Emojisense_Settings::parse_emoji_list( $emoji, $limit );
	}

	/**
	 * Checks the address, the key and the site origin with one search (GET /v1/search).
	 *
	 * @return true|WP_Error
	 */
	public static function test_connection() {
		$body = self::request(
			'GET',
			'/v1/search',
			array(
				'q'     => 'pizza',
				'limit' => '1',
			)
		);
		return is_wp_error( $body ) ? $body : true;
	}

	/**
	 * Plain text for the API: no tags, no shortcodes, collapsed whitespace, at most MAX_TEXT
	 * characters.
	 *
	 * @param string $text Text or HTML.
	 * @return string
	 */
	public static function plain_text( $text ) {
		$text = wp_strip_all_tags( strip_shortcodes( (string) $text ) );
		$text = html_entity_decode( $text, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$text = trim( (string) preg_replace( '/\s+/u', ' ', $text ) );
		if ( function_exists( 'mb_substr' ) ) {
			return trim( mb_substr( $text, 0, self::MAX_TEXT, 'UTF-8' ) );
		}
		return trim( substr( $text, 0, self::MAX_TEXT ) );
	}

	/**
	 * One API request.
	 *
	 * @param string               $method GET or POST.
	 * @param string               $path   API path.
	 * @param array<string,string> $query  Query parameters.
	 * @param array<string,mixed>  $json   JSON body for POST.
	 * @return array<string,mixed>|WP_Error The decoded JSON body.
	 */
	private static function request( $method, $path, $query = array(), $json = null ) {
		$key = Emojisense_Settings::publishable_key();
		if ( '' !== $key ) {
			$query['key'] = $key;
		}
		$url     = add_query_arg( array_map( 'rawurlencode', $query ), Emojisense_Settings::api_url() . $path );
		$origins = Emojisense_Settings::site_origins();
		$args    = array(
			'method'      => $method,
			'timeout'     => self::TIMEOUT,
			'redirection' => 0,
			'headers'     => array(
				'Accept' => 'application/json',
				'Origin' => $origins ? $origins[0] : '',
			),
		);
		if ( null !== $json ) {
			$args['headers']['Content-Type'] = 'application/json';
			$args['body']                    = wp_json_encode( $json );
		}

		$response = wp_safe_remote_request( $url, $args );
		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'emojisense_unreachable',
				/* translators: %s: error message from the HTTP request. */
				sprintf( __( 'The Emojisense API could not be reached: %s', 'emojisense' ), $response->get_error_message() )
			);
		}
		$status = (int) wp_remote_retrieve_response_code( $response );
		$body   = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( 200 !== $status ) {
			return self::status_error( $status, is_array( $body ) && isset( $body['error'] ) && is_string( $body['error'] ) ? $body['error'] : '' );
		}
		if ( ! is_array( $body ) ) {
			return new WP_Error( 'emojisense_bad_response', __( 'The Emojisense API sent an answer this plugin cannot read.', 'emojisense' ) );
		}
		return $body;
	}

	/**
	 * An error with advice the admin can act on.
	 *
	 * @param int    $status HTTP status.
	 * @param string $detail Error text from the API.
	 * @return WP_Error
	 */
	private static function status_error( $status, $detail ) {
		switch ( $status ) {
			case 401:
				$message = __( 'The key is unknown or revoked. Copy a publishable key from app.emojisense.com.', 'emojisense' );
				break;
			case 403:
				$message = sprintf(
					/* translators: %s: the site origin, e.g. https://example.com */
					__( 'The key does not allow this site. Add %s to the allowed origins of the key at app.emojisense.com.', 'emojisense' ),
					implode( ', ', Emojisense_Settings::site_origins() )
				);
				break;
			case 429:
				$message = __( 'Too many requests. Try again in a minute.', 'emojisense' );
				break;
			default:
				/* translators: %d: HTTP status code. */
				$message = sprintf( __( 'The Emojisense API answered with HTTP %d.', 'emojisense' ), $status );
		}
		if ( '' !== $detail ) {
			$message .= ' (' . sanitize_text_field( $detail ) . ')';
		}
		return new WP_Error( 'emojisense_http_' . $status, $message, array( 'status' => $status ) );
	}
}
