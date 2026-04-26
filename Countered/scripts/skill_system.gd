extends Node
## Skill System — Executes unit special abilities when mana is full.
## Autoloaded as "SkillSystem"


## Execute a skill. Returns an array of effect dictionaries.
func execute_skill(caster_data: Dictionary, caster_pos: Vector2i, allies: Array, enemies: Array) -> Array:
	var skill_type: String = caster_data.get("skill_type", "")
	var params: Dictionary = caster_data.get("skill_params", {})
	var effects: Array = []

	match skill_type:
		"shield":
			effects.append({
				"type": "shield",
				"target_id": caster_data.get("instance_id", ""),
				"value": params.get("shield_amount", 100),
				"duration": params.get("duration", 3.0)
			})

		"line_damage":
			var damage: float = params.get("damage", 100)
			var count: int = params.get("pierce_count", 1)
			var sorted_enemies: Array = _sort_by_distance(caster_pos, enemies)
			for i in mini(count + 1, sorted_enemies.size()):
				effects.append({
					"type": "damage",
					"target_id": sorted_enemies[i].get("instance_id", ""),
					"value": damage
				})

		"aoe_damage":
			var damage: float = params.get("damage", 100)
			var radius: int = params.get("radius", 2)
			for enemy in enemies:
				var epos: Vector2i = enemy.get("grid_pos", Vector2i.ZERO)
				if AITargeting.manhattan_distance(caster_pos, epos) <= radius:
					effects.append({
						"type": "damage",
						"target_id": enemy.get("instance_id", ""),
						"value": damage
					})

		"aoe_stun":
			var stun_dur: float = params.get("stun_duration", 1.0)
			var radius: int = params.get("radius", 1)
			for enemy in enemies:
				var epos: Vector2i = enemy.get("grid_pos", Vector2i.ZERO)
				if AITargeting.manhattan_distance(caster_pos, epos) <= radius:
					effects.append({
						"type": "stun",
						"target_id": enemy.get("instance_id", ""),
						"duration": stun_dur
					})

		"multi_hit":
			var hits: int = params.get("hits", 3)
			var dmg_per: float = params.get("damage_per_hit", 40)
			var nearest: Dictionary = _get_nearest_enemy(caster_pos, enemies)
			if not nearest.is_empty():
				for i in hits:
					effects.append({
						"type": "damage",
						"target_id": nearest.get("instance_id", ""),
						"value": dmg_per
					})

		"heal":
			var heal_amount: float = params.get("heal_amount", 200)
			var lowest_ally: Dictionary = _get_lowest_hp_ally(allies)
			if not lowest_ally.is_empty():
				effects.append({
					"type": "heal",
					"target_id": lowest_ally.get("instance_id", ""),
					"value": heal_amount
				})

		"lifesteal":
			var damage: float = params.get("damage", 100)
			var heal_pct: float = params.get("heal_percent", 0.5)
			var nearest: Dictionary = _get_nearest_enemy(caster_pos, enemies)
			if not nearest.is_empty():
				effects.append({
					"type": "damage",
					"target_id": nearest.get("instance_id", ""),
					"value": damage
				})
				effects.append({
					"type": "heal",
					"target_id": caster_data.get("instance_id", ""),
					"value": damage * heal_pct
				})

		"damage_slow":
			var damage: float = params.get("damage", 180)
			var slow_pct: float = params.get("slow_percent", 0.3)
			var dur: float = params.get("duration", 2.0)
			var nearest: Dictionary = _get_nearest_enemy(caster_pos, enemies)
			if not nearest.is_empty():
				effects.append({
					"type": "damage",
					"target_id": nearest.get("instance_id", ""),
					"value": damage
				})
				effects.append({
					"type": "slow",
					"target_id": nearest.get("instance_id", ""),
					"value": slow_pct,
					"duration": dur
				})

		"teleport_damage":
			var damage: float = params.get("damage", 250)
			var nearest: Dictionary = _get_nearest_enemy(caster_pos, enemies)
			if not nearest.is_empty():
				effects.append({
					"type": "teleport",
					"target_id": caster_data.get("instance_id", ""),
					"destination": nearest.get("grid_pos", Vector2i.ZERO)
				})
				effects.append({
					"type": "damage",
					"target_id": nearest.get("instance_id", ""),
					"value": damage
				})

		"create_block":
			var dur: float = params.get("duration", 3.0)
			effects.append({
				"type": "create_block",
				"position": caster_pos + Vector2i(0, -1),
				"duration": dur
			})

		"chain_damage":
			var damage: float = params.get("damage", 100)
			var bounces: int = params.get("bounces", 2)
			var sorted_enemies: Array = _sort_by_distance(caster_pos, enemies)
			for i in mini(bounces + 1, sorted_enemies.size()):
				effects.append({
					"type": "damage",
					"target_id": sorted_enemies[i].get("instance_id", ""),
					"value": damage
				})

	return effects


func _sort_by_distance(from: Vector2i, units: Array) -> Array:
	var sorted: Array = units.duplicate()
	sorted.sort_custom(func(a, b):
		var da: int = AITargeting.manhattan_distance(from, a.get("grid_pos", Vector2i.ZERO))
		var db: int = AITargeting.manhattan_distance(from, b.get("grid_pos", Vector2i.ZERO))
		return da < db
	)
	return sorted


func _get_nearest_enemy(from: Vector2i, enemies: Array) -> Dictionary:
	var sorted: Array = _sort_by_distance(from, enemies)
	return sorted[0] if sorted.size() > 0 else {}


func _get_lowest_hp_ally(allies: Array) -> Dictionary:
	var lowest: Dictionary = {}
	var lowest_hp: float = INF
	for ally in allies:
		var hp: float = ally.get("current_hp", 0)
		if hp < lowest_hp and hp > 0:
			lowest_hp = hp
			lowest = ally
	return lowest
