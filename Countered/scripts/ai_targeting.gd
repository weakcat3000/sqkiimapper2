extends Node
## AI Targeting — Determines which enemy a unit should attack.
## Autoloaded as "AITargeting"

## Role-based targeting priorities
## Duelists prefer squishy targets; Vanguards and Bruisers prefer nearest
var ROLE_PRIORITY: Dictionary = {
	"vanguard": ["nearest"],
	"duelist": ["support", "caster", "ranger", "lowest_hp"],
	"ranger": ["nearest"],
	"caster": ["nearest"],
	"bruiser": ["nearest"],
	"support": ["nearest"]
}


## Find the best target for a unit from a list of enemies.
## Each enemy should have: grid_pos (Vector2i), role, current_hp
func find_target(unit_data: Dictionary, unit_pos: Vector2i, enemies: Array) -> Dictionary:
	if enemies.is_empty():
		return {}

	var role: String = unit_data.get("role", "")
	var priorities: Array = ROLE_PRIORITY.get(role, ["nearest"])

	# For duelists, try to find priority role targets first
	if role == "duelist":
		for priority_role in priorities:
			if priority_role == "nearest" or priority_role == "lowest_hp":
				continue
			for enemy in enemies:
				if enemy.get("role", "") == priority_role:
					return enemy

	# Default: find nearest enemy
	var best_target: Dictionary = {}
	var best_distance: float = INF

	for enemy in enemies:
		var enemy_pos: Vector2i = enemy.get("grid_pos", Vector2i.ZERO)
		var dist: int = manhattan_distance(unit_pos, enemy_pos)
		if dist < best_distance:
			best_distance = dist
			best_target = enemy

	return best_target


## Manhattan distance between two grid positions
func manhattan_distance(a: Vector2i, b: Vector2i) -> int:
	return absi(a.x - b.x) + absi(a.y - b.y)
