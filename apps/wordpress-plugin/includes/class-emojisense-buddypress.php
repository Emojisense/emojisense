<?php
/**
 * BuddyPress: emoji in the activity, activity comment and message forms, and reactions under
 * activity updates.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * Activity items are not posts: their reactions are a target of their own ("activity"), with
 * the counts in activity meta. Only public activity shows reactions, because reaction requests
 * are anonymous.
 */
class Emojisense_Buddypress {

	/** The post form, the activity comment fields and the message field (Nouveau and Legacy). */
	const FIELD_SELECTORS = array( '#whats-new', 'textarea.ac-input', '#message_content' );

	/**
	 * Whether BuddyPress is active.
	 *
	 * @return bool
	 */
	public static function is_active() {
		return function_exists( 'buddypress' );
	}

	/**
	 * Whether activity reactions are on.
	 *
	 * @return bool
	 */
	public static function reactions_on() {
		return self::is_active() && function_exists( 'bp_is_active' ) && bp_is_active( 'activity' )
			&& (bool) Emojisense_Settings::value( 'activity_reactions' );
	}

	/**
	 * Hooks. They do nothing until BuddyPress loads and the settings turn them on.
	 */
	public function register() {
		add_filter( 'emojisense_reaction_targets', array( $this, 'reaction_targets' ) );
		add_filter( 'emojisense_staticize_filters', array( $this, 'staticize_filters' ) );
		add_filter( 'emojisense_field_selectors', array( $this, 'field_selectors' ) );
		add_action( 'bp_activity_entry_meta', array( $this, 'render_reactions' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );
	}

	/**
	 * Adds the activity target.
	 *
	 * @param array<string, Emojisense_Reaction_Target> $targets Targets by REST type.
	 * @return array<string, Emojisense_Reaction_Target>
	 */
	public function reaction_targets( $targets ) {
		if ( self::reactions_on() ) {
			$targets['activity'] = new Emojisense_Activity_Reactions();
		}
		return $targets;
	}

	/**
	 * Hosted emoji sets also draw activity.
	 *
	 * @param string[] $hooks Content filters.
	 * @return string[]
	 */
	public function staticize_filters( $hooks ) {
		return self::is_active() ? array_merge( (array) $hooks, array( 'bp_get_activity_content_body', 'bp_activity_comment_content' ) ) : $hooks;
	}

	/**
	 * The activity, comment and message fields get the emoji button and colon search.
	 *
	 * @param string[] $selectors Field selectors.
	 * @return string[]
	 */
	public function field_selectors( $selectors ) {
		if ( ! self::is_active() || ! Emojisense_Settings::value( 'forum_fields' ) ) {
			return $selectors;
		}
		return array_merge( (array) $selectors, self::FIELD_SELECTORS );
	}

	/**
	 * The reaction bar in the meta row of the activity item in the loop.
	 */
	public function render_reactions() {
		if ( ! self::reactions_on() ) {
			return;
		}
		global $activities_template;
		$activity = isset( $activities_template->activity ) ? $activities_template->activity : null;
		if ( Emojisense_Activity_Reactions::shows_reactions( $activity ) ) {
			echo Emojisense_Reactions::render( (int) $activity->id, 'activity' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- render() escapes every value.
		}
	}

	/**
	 * Scripts on BuddyPress pages. Activity loads more items later ("Load more", filters), so
	 * the reactions script comes up front.
	 */
	public function enqueue_assets() {
		if ( ! self::is_active() || ! function_exists( 'is_buddypress' ) || ! is_buddypress() ) {
			return;
		}
		if ( Emojisense_Settings::value( 'forum_fields' ) ) {
			Emojisense_Fields::enqueue();
		}
		if ( self::reactions_on() ) {
			Emojisense_Reactions::enqueue_script();
		}
	}
}
