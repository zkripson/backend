/**
 * Ship Tracking and Validation Utilities
 *
 * Handles ship placement validation, hit tracking, and ship sinking logic
 * for production-grade battleship games
 */

export interface Ship {
	id: string;
	length: number;
	cells: Array<{ x: number; y: number }>;
	hits: Array<{ x: number; y: number }>;
	isSunk: boolean;
}

export interface Board {
	size: number;
	ships: Ship[];
	cells: number[][]; // 0 = water, 1-5 = ship parts
}

export class ShipTracker {
	private static readonly SHIP_LENGTHS = [5, 4, 3, 3, 2];
	private static readonly BOARD_SIZE = 10;

	/**
	 * Validate ship placement on board
	 */
	static validateShipPlacement(ships: Ship[]): boolean {
		// Check if we have the correct number of ships
		if (ships.length !== this.SHIP_LENGTHS.length) {
			return false;
		}

		// Check if each ship has the correct length
		const lengths = ships.map((ship) => ship.length).sort((a, b) => b - a);
		const expectedLengths = [...this.SHIP_LENGTHS].sort((a, b) => b - a);

		if (!this.arraysEqual(lengths, expectedLengths)) {
			return false;
		}

		// Check for overlaps and valid positions
		const occupiedCells = new Set<string>();

		for (const ship of ships) {
			// Validate ship cells are consecutive and in line
			if (!this.isValidShipLayout(ship)) {
				return false;
			}

			// Check each cell of the ship
			for (const cell of ship.cells) {
				// Check if cell is within board bounds
				if (cell.x < 0 || cell.x >= this.BOARD_SIZE || cell.y < 0 || cell.y >= this.BOARD_SIZE) {
					return false;
				}

				// Check if cell is already occupied
				const cellKey = `${cell.x},${cell.y}`;
				if (occupiedCells.has(cellKey)) {
					return false;
				}
				occupiedCells.add(cellKey);
			}

			// Check ship doesn't touch other ships (including diagonally)
			if (!this.checkShipSpacing(ship, occupiedCells)) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Check if ship cells form a valid line (horizontal or vertical)
	 */
	private static isValidShipLayout(ship: Ship): boolean {
		if (ship.cells.length !== ship.length) {
			return false;
		}

		if (ship.cells.length === 1) {
			return true;
		}

		// Sort cells to check if they're consecutive
		const sortedCells = [...ship.cells];

		// Check if horizontal
		sortedCells.sort((a, b) => a.x - b.x);
		let isHorizontal = true;
		for (let i = 1; i < sortedCells.length; i++) {
			if (sortedCells[i].y !== sortedCells[i - 1].y || sortedCells[i].x !== sortedCells[i - 1].x + 1) {
				isHorizontal = false;
				break;
			}
		}

		// Check if vertical
		sortedCells.sort((a, b) => a.y - b.y);
		let isVertical = true;
		for (let i = 1; i < sortedCells.length; i++) {
			if (sortedCells[i].x !== sortedCells[i - 1].x || sortedCells[i].y !== sortedCells[i - 1].y + 1) {
				isVertical = false;
				break;
			}
		}

		return isHorizontal || isVertical;
	}

	/**
	 * Check ship spacing (ships shouldn't touch)
	 */
	private static checkShipSpacing(ship: Ship, allOccupiedCells: Set<string>): boolean {
		for (const cell of ship.cells) {
			// Check all 8 adjacent cells
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (dx === 0 && dy === 0) continue; // Skip the cell itself

					const adjacentX = cell.x + dx;
					const adjacentY = cell.y + dy;
					const adjacentKey = `${adjacentX},${adjacentY}`;

					// If adjacent cell is within bounds and occupied by another ship
					if (
						adjacentX >= 0 &&
						adjacentX < this.BOARD_SIZE &&
						adjacentY >= 0 &&
						adjacentY < this.BOARD_SIZE &&
						allOccupiedCells.has(adjacentKey) &&
						!ship.cells.some((c) => c.x === adjacentX && c.y === adjacentY)
					) {
						return false;
					}
				}
			}
		}
		return true;
	}

	/**
	 * Create board representation from ships
	 */
	static createBoardFromShips(ships: Ship[]): Board {
		const cells: number[][] = Array(this.BOARD_SIZE)
			.fill(null)
			.map(() => Array(this.BOARD_SIZE).fill(0));

		ships.forEach((ship, shipIndex) => {
			ship.cells.forEach((cell) => {
				cells[cell.y][cell.x] = shipIndex + 1;
			});
		});

		return {
			size: this.BOARD_SIZE,
			ships: ships.map((ship) => ({ ...ship, hits: [], isSunk: false })),
			cells,
		};
	}

	/**
	 * Process a shot and update ship state
	 */
	static processShot(
		board: Board,
		x: number,
		y: number,
		shootingPlayer: string
	): {
		isHit: boolean;
		shipSunk: Ship | null;
		sunkShipsCount: number;
	} {
		// Check if coordinates are valid
		if (x < 0 || x >= this.BOARD_SIZE || y < 0 || y >= this.BOARD_SIZE) {
			return { isHit: false, shipSunk: null, sunkShipsCount: 0 };
		}

		const cellValue = board.cells[y][x];
		const isHit = cellValue > 0;

		if (!isHit) {
			return { isHit: false, shipSunk: null, sunkShipsCount: 0 };
		}

		// Find the ship that was hit
		const shipIndex = cellValue - 1;
		const ship = board.ships[shipIndex];

		// Add hit to ship if not already hit
		const hitCell = { x, y };
		if (!ship.hits.some((hit) => hit.x === x && hit.y === y)) {
			ship.hits.push(hitCell);
		}

		// Check if ship is now sunk
		let shipSunk: Ship | null = null;
		if (ship.hits.length === ship.length && !ship.isSunk) {
			ship.isSunk = true;
			shipSunk = ship;
		}

		// Count total sunk ships
		const sunkShipsCount = board.ships.filter((s) => s.isSunk).length;

		return { isHit, shipSunk, sunkShipsCount };
	}

	/**
	 * Check if all ships are sunk
	 */
	static areAllShipsSunk(board: Board): boolean {
		return board.ships.every((ship) => ship.isSunk);
	}

	/**
	 * Get ship by cell coordinates
	 */
	static getShipAtPosition(board: Board, x: number, y: number): Ship | null {
		if (x < 0 || x >= this.BOARD_SIZE || y < 0 || y >= this.BOARD_SIZE) {
			return null;
		}

		const cellValue = board.cells[y][x];
		if (cellValue === 0) {
			return null;
		}

		return board.ships[cellValue - 1];
	}

	/**
	 * Generate ship placement suggestions
	 */
	static generateRandomShipPlacement(): Ship[] {
		const ships: Ship[] = [];
		const occupiedCells = new Set<string>();

		for (let i = 0; i < this.SHIP_LENGTHS.length; i++) {
			const length = this.SHIP_LENGTHS[i];
			let placed = false;
			let attempts = 0;

			while (!placed && attempts < 1000) {
				const isHorizontal = Math.random() > 0.5;
				const startX = Math.floor(Math.random() * (this.BOARD_SIZE - (isHorizontal ? length : 1)));
				const startY = Math.floor(Math.random() * (this.BOARD_SIZE - (isHorizontal ? 1 : length)));

				const cells: Array<{ x: number; y: number }> = [];
				for (let j = 0; j < length; j++) {
					if (isHorizontal) {
						cells.push({ x: startX + j, y: startY });
					} else {
						cells.push({ x: startX, y: startY + j });
					}
				}

				// Check if placement is valid
				let canPlace = true;
				for (const cell of cells) {
					const cellKey = `${cell.x},${cell.y}`;
					if (occupiedCells.has(cellKey)) {
						canPlace = false;
						break;
					}

					// Check adjacent cells
					for (let dx = -1; dx <= 1; dx++) {
						for (let dy = -1; dy <= 1; dy++) {
							const adjX = cell.x + dx;
							const adjY = cell.y + dy;
							const adjKey = `${adjX},${adjY}`;

							if (adjX >= 0 && adjX < this.BOARD_SIZE && adjY >= 0 && adjY < this.BOARD_SIZE && occupiedCells.has(adjKey)) {
								canPlace = false;
								break;
							}
						}
						if (!canPlace) break;
					}
					if (!canPlace) break;
				}

				if (canPlace) {
					// Mark all cells and adjacent cells as occupied
					for (const cell of cells) {
						const cellKey = `${cell.x},${cell.y}`;
						occupiedCells.add(cellKey);
					}

					ships.push({
						id: `ship-${i}`,
						length,
						cells,
						hits: [],
						isSunk: false,
					});
					placed = true;
				}

				attempts++;
			}

			if (!placed) {
				throw new Error(`Failed to place ship of length ${length} after ${attempts} attempts`);
			}
		}

		return ships;
	}

	/**
	 * Convert ships to compact representation for ZK proofs
	 */
	static shipsToCompactRepresentation(ships: Ship[]): string {
		const board = Array(this.BOARD_SIZE)
			.fill(null)
			.map(() => Array(this.BOARD_SIZE).fill(0));

		ships.forEach((ship, shipIndex) => {
			ship.cells.forEach((cell) => {
				board[cell.y][cell.x] = shipIndex + 1;
			});
		});

		return board.flat().join('');
	}

	/**
	 * Extract ships from compact representation
	 */
	static shipsFromCompactRepresentation(representation: string): Ship[] {
		const ships: Ship[] = [];
		const shipLengths = [...this.SHIP_LENGTHS];
		const board: number[][] = [];

		// Parse the compact representation back to 2D array
		for (let i = 0; i < this.BOARD_SIZE; i++) {
			board[i] = [];
			for (let j = 0; j < this.BOARD_SIZE; j++) {
				const index = i * this.BOARD_SIZE + j;
				board[i][j] = parseInt(representation[index]) || 0;
			}
		}

		// Find ships
		const shipCells: Array<Array<{ x: number; y: number }>> = [];
		for (let i = 0; i < this.SHIP_LENGTHS.length; i++) {
			shipCells[i] = [];
		}

		for (let y = 0; y < this.BOARD_SIZE; y++) {
			for (let x = 0; x < this.BOARD_SIZE; x++) {
				const cellValue = board[y][x];
				if (cellValue > 0) {
					shipCells[cellValue - 1].push({ x, y });
				}
			}
		}

		// Create ship objects
		for (let i = 0; i < shipCells.length; i++) {
			if (shipCells[i].length > 0) {
				ships.push({
					id: `ship-${i}`,
					length: shipLengths[i],
					cells: shipCells[i],
					hits: [],
					isSunk: false,
				});
			}
		}

		return ships;
	}

	// Helper method to compare arrays
	private static arraysEqual(a: number[], b: number[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}
}
