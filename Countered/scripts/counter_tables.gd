extends Node
## Counter Tables — Static data for attack-vs-armor and element-vs-element multipliers.
## Autoloaded as "CounterTables"

# Attack vs Armor multiplier matrix
# Key: attack_type, Value: { armor_type: multiplier }
# 1.5 = strong, 0.75 = weak, 1.0 = neutral
const ATTACK_VS_ARMOR: Dictionary = {
	"slash": {
		"plate": 0.75, "leather": 1.5, "mystic_weave": 1.0,
		"boneguard": 1.0, "crystal_shell": 1.0, "shadow_cloak": 1.0
	},
	"pierce": {
		"plate": 1.0, "leather": 1.0, "mystic_weave": 1.5,
		"boneguard": 1.0, "crystal_shell": 0.75, "shadow_cloak": 1.0
	},
	"crush": {
		"plate": 1.5, "leather": 1.0, "mystic_weave": 1.0,
		"boneguard": 1.0, "crystal_shell": 1.0, "shadow_cloak": 0.75
	},
	"shot": {
		"plate": 1.0, "leather": 1.0, "mystic_weave": 1.0,
		"boneguard": 0.75, "crystal_shell": 1.0, "shadow_cloak": 1.5
	},
	"arcane": {
		"plate": 1.0, "leather": 1.0, "mystic_weave": 0.75,
		"boneguard": 1.5, "crystal_shell": 1.0, "shadow_cloak": 1.0
	},
	"siege": {
		"plate": 1.0, "leather": 0.75, "mystic_weave": 1.0,
		"boneguard": 1.0, "crystal_shell": 1.5, "shadow_cloak": 1.0
	}
}

# Element vs Element multiplier matrix
# 1.3 = strong, 0.7 = weak, 1.0 = neutral
# Fire > Earth > Storm > Water > Fire, Light <> Void
const ELEMENT_VS_ELEMENT: Dictionary = {
	"fire": {
		"fire": 1.0, "water": 0.7, "earth": 1.3,
		"storm": 1.0, "light": 1.0, "void": 1.0
	},
	"water": {
		"fire": 1.3, "water": 1.0, "earth": 1.0,
		"storm": 0.7, "light": 1.0, "void": 1.0
	},
	"earth": {
		"fire": 0.7, "water": 1.0, "earth": 1.0,
		"storm": 1.3, "light": 1.0, "void": 1.0
	},
	"storm": {
		"fire": 1.0, "water": 1.3, "earth": 0.7,
		"storm": 1.0, "light": 1.0, "void": 1.0
	},
	"light": {
		"fire": 1.0, "water": 1.0, "earth": 1.0,
		"storm": 1.0, "light": 1.0, "void": 1.3
	},
	"void": {
		"fire": 1.0, "water": 1.0, "earth": 1.0,
		"storm": 1.0, "light": 1.3, "void": 1.0
	}
}


func get_armor_multiplier(attack_type: String, armor_type: String) -> float:
	if ATTACK_VS_ARMOR.has(attack_type) and ATTACK_VS_ARMOR[attack_type].has(armor_type):
		return ATTACK_VS_ARMOR[attack_type][armor_type]
	return 1.0


func get_element_multiplier(attacker_element: String, defender_element: String) -> float:
	if ELEMENT_VS_ELEMENT.has(attacker_element) and ELEMENT_VS_ELEMENT[attacker_element].has(defender_element):
		return ELEMENT_VS_ELEMENT[attacker_element][defender_element]
	return 1.0
