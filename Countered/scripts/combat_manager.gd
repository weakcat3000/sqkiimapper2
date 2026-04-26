extends Node
## Combat Manager — Calculates damage using counter tables.
## Autoloaded as "CombatManager"


## Calculate final damage from attacker to defender
func calculate_damage(attacker: Dictionary, defender: Dictionary) -> float:
	var base_damage: float = attacker.get("attack", 0)

	# Apply attack-vs-armor multiplier
	var armor_mult := CounterTables.get_armor_multiplier(
		attacker.get("attack_type", ""),
		defender.get("armor_type", "")
	)

	# Apply element-vs-element multiplier
	var element_mult := CounterTables.get_element_multiplier(
		attacker.get("element", ""),
		defender.get("element", "")
	)

	var final_damage := base_damage * armor_mult * element_mult

	# Small random variance ±10%
	final_damage *= randf_range(0.9, 1.1)

	return snappedf(final_damage, 1.0)


## Calculate mana gained from attacking
func get_mana_on_attack() -> float:
	return 10.0


## Calculate mana gained from being hit
func get_mana_on_hit() -> float:
	return 5.0
