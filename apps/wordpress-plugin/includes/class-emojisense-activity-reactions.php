<?php
/**
 * Reactions on BuddyPress activity items.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * BuddyPress activity items with reactions: activity updates by default, public only.
 */
class Emojisense_Activity_Reactions implements Emojisense_Reaction_Target {

	/**
	 * Whether an activity item shows reactions: public (not hidden, not spam, readable by a
	 * visitor without an account) and of a type with reactions.
	 *
	 * @param object|null $activity A BP_Activity_Activity or an activity row.
	 * @return bool
	 */
	public static function shows_reactions( $activity ) {
		if ( ! is_object( $activity ) || empty( $activity->id ) ) {
			return false;
		}
		/**
		 * Filters the activity types with reactions.
		 *
		 * @param string[] $types Activity types. Default: activity updates.
		 */
		$types = (array) apply_filters( 'emojisense_activity_reaction_types', array( 'activity_update' ) );
		$show  = in_array( (string) $activity->type, $types, true )
			&& empty( $activity->hide_sitewide )
			&& empty( $activity->is_spam );
		if ( $show && function_exists( 'bp_activity_user_can_read' ) ) {
			$show = (bool) bp_activity_user_can_read( $activity, 0 );
		}
		/**
		 * Filters whether an activity item shows emoji reactions.
		 *
		 * @param bool   $show     Whether the item shows reactions.
		 * @param object $activity The activity item.
		 */
		return (bool) apply_filters( 'emojisense_show_activity_reactions', $show, $activity );
	}

	/**
	 * Whether the activity item shows reactions.
	 *
	 * @param int $id Activity ID.
	 * @return bool
	 */
	public function can_view( $id ) {
		if ( ! class_exists( 'BP_Activity_Activity' ) ) {
			return false;
		}
		$activity = new BP_Activity_Activity( (int) $id );
		return self::shows_reactions( $activity );
	}

	/**
	 * Activity items offer the default reactions.
	 *
	 * @param int $id Activity ID.
	 * @return string[]
	 */
	public function reaction_set( $id ) {
		return Emojisense_Settings::default_reactions();
	}

	/**
	 * Counts from activity meta.
	 *
	 * @param int $id Activity ID.
	 * @return mixed
	 */
	public function stored_counts( $id ) {
		return bp_activity_get_meta( (int) $id, Emojisense_Reactions::META_COUNTS, true );
	}

	/**
	 * Counts to activity meta.
	 *
	 * @param int               $id     Activity ID.
	 * @param array<string,int> $counts Counts.
	 */
	public function save_counts( $id, $counts ) {
		bp_activity_update_meta( (int) $id, Emojisense_Reactions::META_COUNTS, $counts );
	}

	/**
	 * Accessible name of the bar.
	 *
	 * @return string
	 */
	public function label() {
		return __( 'React to this update', 'emojisense' );
	}
}
