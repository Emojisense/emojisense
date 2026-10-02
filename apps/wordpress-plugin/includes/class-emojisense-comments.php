<?php
/**
 * An emoji picker in the comment form.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * Adds an "Emoji" button under the comment field. The button opens <emojisense-picker>, which
 * loads the packs from this site the first time it opens.
 */
class Emojisense_Comments {

	/**
	 * Hooks.
	 */
	public function register() {
		add_filter( 'comment_form_field_comment', array( $this, 'add_button' ) );
	}

	/**
	 * Appends the button (hidden until the script runs) to the comment field markup.
	 *
	 * @param string $field Comment field HTML.
	 * @return string
	 */
	public function add_button( $field ) {
		if ( ! Emojisense_Settings::value( 'comment_picker' ) || is_admin() ) {
			return $field;
		}
		$handle = Emojisense_Assets::enqueue( 'comments' );
		if ( '' === $handle ) {
			return $field;
		}
		if ( ! wp_script_is( $handle, 'done' ) ) {
			Emojisense_Assets::add_config(
				$handle,
				array(
					'strings' => array(
						'dialog'      => __( 'Emoji picker', 'emojisense' ),
						'placeholder' => __( 'Search emoji…', 'emojisense' ),
					),
				)
			);
		}
		$button = sprintf(
			'<p class="emojisense-comment-tools"><button type="button" class="emojisense-comment-button" aria-expanded="false" aria-haspopup="dialog" hidden><span aria-hidden="true">🙂</span> %s</button></p>',
			esc_html__( 'Emoji', 'emojisense' )
		);
		return $field . $button;
	}
}
