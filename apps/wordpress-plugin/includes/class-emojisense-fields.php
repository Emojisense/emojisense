<?php
/**
 * Emoji in plain text fields on the front end: an "Emoji" button with the picker, and colon
 * search while typing. The comment form, and the bbPress and BuddyPress forms.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * The script finds the fields by CSS selector, also fields that appear later (BuddyPress loads
 * forms with JavaScript), and adds the button after each one. The packs load the first time a
 * field gets the focus.
 */
class Emojisense_Fields {

	/** The comment field of `comment_form()`. */
	const COMMENT_SELECTORS = array( 'textarea[name="comment"]' );

	/**
	 * Whether the page already has the field script configuration.
	 *
	 * @var bool
	 */
	private static $configured = false;

	/**
	 * Hooks.
	 */
	public function register() {
		add_filter( 'comment_form_field_comment', array( $this, 'comment_field' ) );
	}

	/**
	 * Loads the script when a comment form is on the page and the comment picker is on.
	 *
	 * @param string $field The comment field markup.
	 * @return string
	 */
	public function comment_field( $field ) {
		if ( Emojisense_Settings::value( 'comment_picker' ) && ! is_admin() ) {
			self::enqueue();
		}
		return $field;
	}

	/**
	 * Selectors of the fields with emoji on this site.
	 *
	 * @return string[]
	 */
	public static function selectors() {
		$selectors = Emojisense_Settings::value( 'comment_picker' ) ? self::COMMENT_SELECTORS : array();
		/**
		 * Filters the CSS selectors of the text fields that get the emoji button and colon
		 * search. The bbPress and BuddyPress integrations add their form fields.
		 *
		 * @param string[] $selectors CSS selectors of textareas or text inputs.
		 */
		$selectors = (array) apply_filters( 'emojisense_field_selectors', $selectors );
		return array_values( array_unique( array_filter( array_map( 'strval', $selectors ) ) ) );
	}

	/**
	 * The field script and, once per page, its configuration.
	 */
	public static function enqueue() {
		$selectors = self::selectors();
		if ( ! $selectors ) {
			return;
		}
		$handle = Emojisense_Assets::enqueue( 'fields' );
		if ( '' === $handle || self::$configured ) {
			return;
		}
		self::$configured = true;
		Emojisense_Assets::add_config(
			$handle,
			array(
				'fields'  => array( 'selectors' => $selectors ),
				'strings' => array(
					'button'      => __( 'Emoji', 'emojisense' ),
					'dialog'      => __( 'Emoji picker', 'emojisense' ),
					'placeholder' => __( 'Search emoji…', 'emojisense' ),
					'menu'        => __( 'Emoji suggestions', 'emojisense' ),
				),
			)
		);
	}
}
