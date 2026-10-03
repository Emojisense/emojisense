<?php
/**
 * Reactions on posts.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * Posts of the types with reactions: counts in post meta, the author's choice of reactions.
 */
class Emojisense_Post_Reactions implements Emojisense_Reaction_Target {

	/**
	 * Whether the post shows reactions.
	 *
	 * @param int $id Post ID.
	 * @return bool
	 */
	public function can_view( $id ) {
		$post = get_post( (int) $id );
		return $post instanceof WP_Post && Emojisense_Reactions::shows_reactions( $post );
	}

	/**
	 * The author's choice, else the suggestion, else the defaults.
	 *
	 * @param int $id Post ID.
	 * @return string[]
	 */
	public function reaction_set( $id ) {
		return Emojisense_Reactions::reaction_set( (int) $id );
	}

	/**
	 * Counts from post meta.
	 *
	 * @param int $id Post ID.
	 * @return mixed
	 */
	public function stored_counts( $id ) {
		return get_post_meta( (int) $id, Emojisense_Reactions::META_COUNTS, true );
	}

	/**
	 * Counts to post meta.
	 *
	 * @param int               $id     Post ID.
	 * @param array<string,int> $counts Counts.
	 */
	public function save_counts( $id, $counts ) {
		update_post_meta( (int) $id, Emojisense_Reactions::META_COUNTS, $counts );
	}

	/**
	 * Accessible name of the bar.
	 *
	 * @return string
	 */
	public function label() {
		return __( 'React to this post', 'emojisense' );
	}
}
