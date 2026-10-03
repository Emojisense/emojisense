<?php
/**
 * Suggested text for the site's privacy policy (Settings → Privacy).
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * The text describes the defaults and every optional data flow, so admins can keep the parts
 * that apply to their settings.
 */
class Emojisense_Privacy {

	/**
	 * Hooks.
	 */
	public function register() {
		add_action( 'admin_init', array( $this, 'add_policy_content' ) );
	}

	/**
	 * Registers the suggested policy text.
	 */
	public function add_policy_content() {
		if ( ! function_exists( 'wp_add_privacy_policy_content' ) ) {
			return;
		}
		wp_add_privacy_policy_content( 'Emojisense', wp_kses_post( wpautop( self::policy_text(), false ) ) );
	}

	/**
	 * The suggested text.
	 *
	 * @return string
	 */
	public static function policy_text() {
		$api   = esc_html( Emojisense_Settings::api_url() );
		$parts = array(
			'<strong>' . esc_html__( 'Suggested text:', 'emojisense' ) . '</strong> ' . esc_html__( 'This site uses the Emojisense plugin to find emoji and to show emoji reactions.', 'emojisense' ),
			esc_html__( 'Emoji search in the editor, in the comment form and in forum and activity forms runs in your browser with files from this site. By default, no search text and no other data is sent to anyone.', 'emojisense' ),
			esc_html__( 'Reactions: when you react to a post, a forum topic or reply, or an activity update, the site stores only the number of reactions per emoji. It does not store your IP address, your name or an account. To stop abuse, the site keeps a keyed hash of your IP address for at most a few minutes. Your browser remembers which reactions you chose (in local storage) so that you can take them back; this information stays on your device.', 'emojisense' ),
			sprintf(
				/* translators: %s: Emojisense API address. */
				esc_html__( 'If the site owner turns on the Emojisense API, the following data goes to the Emojisense API (%s), which is hosted on Cloudflare: the text you type in an emoji search box (to find emoji by meaning), the title and first 256 characters of a published post (to suggest reactions), and requests for emoji images when the site shows a hosted emoji set. As with any web request, the API receives your IP address; Emojisense uses it only for rate limiting and does not store it. Search text is kept only as anonymous search statistics (the search words, without an IP address or a user). Post text is not stored or logged.', 'emojisense' ),
				$api
			),
			sprintf(
				/* translators: %s: link to the Emojisense privacy page. */
				esc_html__( 'Emojisense privacy notice: %s', 'emojisense' ),
				'<a href="https://emojisense.com/docs/privacy/">https://emojisense.com/docs/privacy/</a>'
			),
		);
		return implode( "\n\n", $parts );
	}
}
