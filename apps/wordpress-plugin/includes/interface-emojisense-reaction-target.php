<?php
/**
 * The interface of the objects that carry reactions: posts, and BuddyPress activity items when
 * BuddyPress is active.
 *
 * @package Emojisense
 */

defined( 'ABSPATH' ) || exit;

/**
 * One kind of object with a reaction bar. The REST route is /reactions/<type>/<id>.
 */
interface Emojisense_Reaction_Target {

	/**
	 * Whether anyone may see the object's reactions (the requests are anonymous).
	 *
	 * @param int $id Object ID.
	 * @return bool
	 */
	public function can_view( $id );

	/**
	 * The reactions the object offers.
	 *
	 * @param int $id Object ID.
	 * @return string[]
	 */
	public function reaction_set( $id );

	/**
	 * Stored counts per emoji, unvalidated.
	 *
	 * @param int $id Object ID.
	 * @return mixed
	 */
	public function stored_counts( $id );

	/**
	 * Stores the counts per emoji.
	 *
	 * @param int               $id     Object ID.
	 * @param array<string,int> $counts Counts.
	 */
	public function save_counts( $id, $counts );

	/**
	 * Accessible name of the reaction bar.
	 *
	 * @return string
	 */
	public function label();
}
