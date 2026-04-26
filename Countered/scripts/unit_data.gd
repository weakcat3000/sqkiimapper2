extends Node
## Unit Data Loader — Parses units.json and provides unit dictionaries.
## Autoloaded as "UnitData"

var _units: Dictionary = {}
var _texture_cache: Dictionary = {}
var _scale_cache: Dictionary = {}

func get_cached_texture(id: String) -> Texture2D:
	return _texture_cache.get(id)

func get_cached_scale(id: String) -> float:
	return _scale_cache.get(id, 1.0)

func set_cached_texture(id: String, tex: Texture2D, sc: float) -> void:
	_texture_cache[id] = tex
	_scale_cache[id] = sc

func _ready() -> void:
	_load_units()


func _load_units() -> void:
	var file := FileAccess.open("res://data/units.json", FileAccess.READ)
	if file == null:
		push_error("UnitData: Could not open units.json")
		return
	var json_text := file.get_as_text()
	file.close()

	var json := JSON.new()
	var error := json.parse(json_text)
	if error != OK:
		push_error("UnitData: JSON parse error at line %d: %s" % [json.get_error_line(), json.get_error_message()])
		return

	var data = json.data
	if data is Array:
		for unit_dict in data:
			if unit_dict is Dictionary and unit_dict.has("id"):
				_units[unit_dict["id"]] = unit_dict
	print("UnitData: Loaded %d units" % _units.size())


## Returns a deep copy of unit data by id
func get_unit(unit_id: String) -> Dictionary:
	if _units.has(unit_id):
		return _units[unit_id].duplicate(true)
	push_warning("UnitData: Unit '%s' not found" % unit_id)
	return {}


## Returns all unit ids
func get_all_ids() -> Array:
	return _units.keys()


## Returns a random selection of unit ids for the shop
func get_random_units(count: int) -> Array:
	var all_ids := get_all_ids()
	all_ids.shuffle()
	return all_ids.slice(0, mini(count, all_ids.size()))
