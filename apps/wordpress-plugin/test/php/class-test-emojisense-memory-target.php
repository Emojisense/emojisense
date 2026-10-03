<?php
/**
 * A reaction target kept in memory, for the REST tests.
 *
 * @package Emojisense
 */

/**
 * A reaction target kept in memory, for the REST tests.
 */
class Test_Emojisense_Memory_Target implements Emojisense_Reaction_Target {

	/**
	 * Counts per object ID.
	 *
	 * @var array<int, array<string,int>>
	 */
	public $counts = array();

	/**
	 * Object 5 is public, everything else is not.
	 *
	 * @param int $id Object ID.
	 * @return bool
	 */
	public function can_view( $id ) {
		return 5 === (int) $id;
	}

	/**
	 * Two reactions.
	 *
	 * @param int $id Object ID.
	 * @return string[]
	 */
	public function reaction_set( $id ) {
		return array( '👍', '🎉' );
	}

	/**
	 * Stored counts.
	 *
	 * @param int $id Object ID.
	 * @return mixed
	 */
	public function stored_counts( $id ) {
		return isset( $this->counts[ $id ] ) ? $this->counts[ $id ] : array();
	}

	/**
	 * Stores counts.
	 *
	 * @param int               $id     Object ID.
	 * @param array<string,int> $counts Counts.
	 */
	public function save_counts( $id, $counts ) {
		$this->counts[ $id ] = $counts;
	}

	/**
	 * Bar label.
	 *
	 * @return string
	 */
	public function label() {
		return 'React to this thing';
	}
}
