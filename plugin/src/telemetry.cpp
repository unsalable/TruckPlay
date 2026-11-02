#include "telemetry.h"

#include <atomic>

#include <scssdk_telemetry.h>
#include <eurotrucks2/scssdk_eut2.h>
#include <eurotrucks2/scssdk_telemetry_eut2.h>
#include <common/scssdk_telemetry_common_configs.h>
#include <common/scssdk_telemetry_common_channels.h>
#include <common/scssdk_telemetry_common_gameplay_events.h>
#include <common/scssdk_telemetry_job_common_channels.h>
#include <common/scssdk_telemetry_trailer_common_channels.h>
#include <common/scssdk_telemetry_truck_common_channels.h>

#include <cstring>
#include <mutex>

#include "json.h"
#include "log.h"

namespace tp {
namespace {

struct Placement {
  double x = 0, y = 0, z = 0;
  float heading = 0, pitch = 0, roll = 0;
};

struct FPlacement {
  float x = 0, y = 0, z = 0;
  float heading = 0, pitch = 0, roll = 0;
};

// Everything the UI needs. Units are the SDK's: m/s, meters, liters, °C, bar, in-game minutes.
struct State {
  bool paused = true;

  scs_u32_t gameTime = 0;
  scs_s32_t restStop = 0;
  scs_s32_t mandatoryBreak = 0;
  float localScale = 0;
  scs_s32_t mpTimeOffset = 0;

  float speed = 0, rpm = 0, cruise = 0;
  scs_s32_t gear = 0, displayedGear = 0;
  float steering = 0, throttle = 0, brake = 0, clutch = 0;
  float fuel = 0, fuelRange = 0, fuelAvg = 0, adblue = 0;
  bool fuelWarn = false, adblueWarn = false;
  float airPressure = 0, brakeTemp = 0, oilPressure = 0, oilTemp = 0, waterTemp = 0, battery = 0;
  bool airWarn = false, airEmergency = false, oilWarn = false, waterWarn = false, batteryWarn = false;
  bool electric = false, engine = false, parkingBrake = false, motorBrake = false;
  scs_u32_t retarder = 0;
  bool lBlinker = false, rBlinker = false, lBlinkLight = false, rBlinkLight = false, hazard = false;
  bool parkingLight = false, lowBeam = false, highBeam = false, beacon = false, brakeLight = false, reverseLight = false;
  scs_u32_t auxFront = 0, auxRoof = 0;
  bool wipers = false, diffLock = false;
  float backlight = 0, odometer = 0;
  float wearEngine = 0, wearTransmission = 0, wearCabin = 0, wearChassis = 0, wearWheels = 0;
  float navDistance = 0, navTime = 0, navSpeedLimit = 0;
  Placement truckPos;
  FPlacement headOffset;
  bool hasHead = false;
  float headX = 0, headY = 0, headZ = 0;

  bool hasTruck = false;
  std::string brand, brandId, truckName, truckId, plate, plateCountry;
  float fuelCapacity = 0, adblueCapacity = 0, rpmLimit = 0, airWarnLevel = 0;
  scs_u32_t gearsForward = 0, gearsReverse = 0, retarderSteps = 0;

  bool trailerConnected = false;
  bool hasTrailer = false;
  std::string trailerName, trailerBrand, trailerPlate, trailerCargoAccessory;
  float trailerWearBody = 0, trailerWearChassis = 0, trailerWearWheels = 0, trailerCargoDamage = 0;
  Placement trailerPos;

  bool hasJob = false;
  std::string cargo, cargoId, srcCity, srcCityId, srcCompany, srcCompanyId, dstCity, dstCityId, dstCompany, dstCompanyId,
      jobMarket;
  float cargoMass = 0, jobCargoDamage = 0;
  scs_u64_t income = 0;
  scs_u32_t deliveryTime = 0, plannedKm = 0;
  bool cargoLoaded = false, specialJob = false;
};

scs_telemetry_init_params_v100_t g_params{};
State g_work;       // touched only on the game thread
State g_published;  // copied at frame end, read by the pipe thread
std::mutex g_mu;
std::vector<std::string> g_events;
std::string g_sdkVersion;

// ---- channel callbacks: copy the value into the field passed as context ----

SCSAPI_VOID StoreFloat(const scs_string_t, const scs_u32_t, const scs_value_t* const v, const scs_context_t ctx) {
  *static_cast<float*>(ctx) = v ? v->value_float.value : 0.0f;
}
SCSAPI_VOID StoreBool(const scs_string_t, const scs_u32_t, const scs_value_t* const v, const scs_context_t ctx) {
  *static_cast<bool*>(ctx) = v ? v->value_bool.value != 0 : false;
}
SCSAPI_VOID StoreS32(const scs_string_t, const scs_u32_t, const scs_value_t* const v, const scs_context_t ctx) {
  *static_cast<scs_s32_t*>(ctx) = v ? v->value_s32.value : 0;
}
SCSAPI_VOID StoreU32(const scs_string_t, const scs_u32_t, const scs_value_t* const v, const scs_context_t ctx) {
  *static_cast<scs_u32_t*>(ctx) = v ? v->value_u32.value : 0;
}
SCSAPI_VOID StorePlacement(const scs_string_t, const scs_u32_t, const scs_value_t* const v, const scs_context_t ctx) {
  auto* p = static_cast<Placement*>(ctx);
  if (!v) return;
  p->x = v->value_dplacement.position.x;
  p->y = v->value_dplacement.position.y;
  p->z = v->value_dplacement.position.z;
  p->heading = v->value_dplacement.orientation.heading;
  p->pitch = v->value_dplacement.orientation.pitch;
  p->roll = v->value_dplacement.orientation.roll;
}

SCSAPI_VOID StoreFPlacement(const scs_string_t, const scs_u32_t, const scs_value_t* const v, const scs_context_t ctx) {
  auto* p = static_cast<FPlacement*>(ctx);
  if (!v) return;
  p->x = v->value_fplacement.position.x;
  p->y = v->value_fplacement.position.y;
  p->z = v->value_fplacement.position.z;
  p->heading = v->value_fplacement.orientation.heading;
  p->pitch = v->value_fplacement.orientation.pitch;
  p->roll = v->value_fplacement.orientation.roll;
}

void Channel(const char* name, scs_value_type_t type, scs_telemetry_channel_callback_t cb, void* field) {
  const scs_result_t r =
      g_params.register_for_channel(name, SCS_U32_NIL, type, SCS_TELEMETRY_CHANNEL_FLAG_no_value, cb, field);
  if (r != SCS_RESULT_ok) TPLOG("channel %s: register failed (%d)", name, r);
}

void RegisterChannels() {
  State& s = g_work;
  Channel(SCS_TELEMETRY_CHANNEL_game_time, SCS_VALUE_TYPE_u32, StoreU32, &s.gameTime);
  Channel(SCS_TELEMETRY_CHANNEL_next_rest_stop, SCS_VALUE_TYPE_s32, StoreS32, &s.restStop);
  Channel(SCS_TELEMETRY_CHANNEL_next_mandatory_break, SCS_VALUE_TYPE_s32, StoreS32, &s.mandatoryBreak);
  Channel(SCS_TELEMETRY_CHANNEL_local_scale, SCS_VALUE_TYPE_float, StoreFloat, &s.localScale);
  Channel(SCS_TELEMETRY_CHANNEL_multiplayer_time_offset, SCS_VALUE_TYPE_s32, StoreS32, &s.mpTimeOffset);

  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_world_placement, SCS_VALUE_TYPE_dplacement, StorePlacement, &s.truckPos);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_head_offset, SCS_VALUE_TYPE_fplacement, StoreFPlacement, &s.headOffset);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_speed, SCS_VALUE_TYPE_float, StoreFloat, &s.speed);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_engine_rpm, SCS_VALUE_TYPE_float, StoreFloat, &s.rpm);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_engine_gear, SCS_VALUE_TYPE_s32, StoreS32, &s.gear);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_displayed_gear, SCS_VALUE_TYPE_s32, StoreS32, &s.displayedGear);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_cruise_control, SCS_VALUE_TYPE_float, StoreFloat, &s.cruise);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_effective_steering, SCS_VALUE_TYPE_float, StoreFloat, &s.steering);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_effective_throttle, SCS_VALUE_TYPE_float, StoreFloat, &s.throttle);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_effective_brake, SCS_VALUE_TYPE_float, StoreFloat, &s.brake);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_effective_clutch, SCS_VALUE_TYPE_float, StoreFloat, &s.clutch);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_parking_brake, SCS_VALUE_TYPE_bool, StoreBool, &s.parkingBrake);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_motor_brake, SCS_VALUE_TYPE_bool, StoreBool, &s.motorBrake);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_retarder_level, SCS_VALUE_TYPE_u32, StoreU32, &s.retarder);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_brake_air_pressure, SCS_VALUE_TYPE_float, StoreFloat, &s.airPressure);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_brake_air_pressure_warning, SCS_VALUE_TYPE_bool, StoreBool, &s.airWarn);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_brake_air_pressure_emergency, SCS_VALUE_TYPE_bool, StoreBool, &s.airEmergency);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_brake_temperature, SCS_VALUE_TYPE_float, StoreFloat, &s.brakeTemp);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_fuel, SCS_VALUE_TYPE_float, StoreFloat, &s.fuel);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_fuel_warning, SCS_VALUE_TYPE_bool, StoreBool, &s.fuelWarn);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_fuel_average_consumption, SCS_VALUE_TYPE_float, StoreFloat, &s.fuelAvg);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_fuel_range, SCS_VALUE_TYPE_float, StoreFloat, &s.fuelRange);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_adblue, SCS_VALUE_TYPE_float, StoreFloat, &s.adblue);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_adblue_warning, SCS_VALUE_TYPE_bool, StoreBool, &s.adblueWarn);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_oil_pressure, SCS_VALUE_TYPE_float, StoreFloat, &s.oilPressure);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_oil_pressure_warning, SCS_VALUE_TYPE_bool, StoreBool, &s.oilWarn);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_oil_temperature, SCS_VALUE_TYPE_float, StoreFloat, &s.oilTemp);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_water_temperature, SCS_VALUE_TYPE_float, StoreFloat, &s.waterTemp);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_water_temperature_warning, SCS_VALUE_TYPE_bool, StoreBool, &s.waterWarn);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_battery_voltage, SCS_VALUE_TYPE_float, StoreFloat, &s.battery);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_battery_voltage_warning, SCS_VALUE_TYPE_bool, StoreBool, &s.batteryWarn);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_electric_enabled, SCS_VALUE_TYPE_bool, StoreBool, &s.electric);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_engine_enabled, SCS_VALUE_TYPE_bool, StoreBool, &s.engine);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_lblinker, SCS_VALUE_TYPE_bool, StoreBool, &s.lBlinker);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_rblinker, SCS_VALUE_TYPE_bool, StoreBool, &s.rBlinker);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_light_lblinker, SCS_VALUE_TYPE_bool, StoreBool, &s.lBlinkLight);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_light_rblinker, SCS_VALUE_TYPE_bool, StoreBool, &s.rBlinkLight);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_hazard_warning, SCS_VALUE_TYPE_bool, StoreBool, &s.hazard);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_light_parking, SCS_VALUE_TYPE_bool, StoreBool, &s.parkingLight);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_light_low_beam, SCS_VALUE_TYPE_bool, StoreBool, &s.lowBeam);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_light_high_beam, SCS_VALUE_TYPE_bool, StoreBool, &s.highBeam);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_light_aux_front, SCS_VALUE_TYPE_u32, StoreU32, &s.auxFront);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_light_aux_roof, SCS_VALUE_TYPE_u32, StoreU32, &s.auxRoof);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_light_beacon, SCS_VALUE_TYPE_bool, StoreBool, &s.beacon);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_light_brake, SCS_VALUE_TYPE_bool, StoreBool, &s.brakeLight);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_light_reverse, SCS_VALUE_TYPE_bool, StoreBool, &s.reverseLight);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_wipers, SCS_VALUE_TYPE_bool, StoreBool, &s.wipers);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_dashboard_backlight, SCS_VALUE_TYPE_float, StoreFloat, &s.backlight);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_differential_lock, SCS_VALUE_TYPE_bool, StoreBool, &s.diffLock);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_wear_engine, SCS_VALUE_TYPE_float, StoreFloat, &s.wearEngine);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_wear_transmission, SCS_VALUE_TYPE_float, StoreFloat, &s.wearTransmission);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_wear_cabin, SCS_VALUE_TYPE_float, StoreFloat, &s.wearCabin);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_wear_chassis, SCS_VALUE_TYPE_float, StoreFloat, &s.wearChassis);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_wear_wheels, SCS_VALUE_TYPE_float, StoreFloat, &s.wearWheels);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_odometer, SCS_VALUE_TYPE_float, StoreFloat, &s.odometer);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_navigation_distance, SCS_VALUE_TYPE_float, StoreFloat, &s.navDistance);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_navigation_time, SCS_VALUE_TYPE_float, StoreFloat, &s.navTime);
  Channel(SCS_TELEMETRY_TRUCK_CHANNEL_navigation_speed_limit, SCS_VALUE_TYPE_float, StoreFloat, &s.navSpeedLimit);

  Channel("trailer.0.connected", SCS_VALUE_TYPE_bool, StoreBool, &s.trailerConnected);
  Channel("trailer.0.world.placement", SCS_VALUE_TYPE_dplacement, StorePlacement, &s.trailerPos);
  Channel("trailer.0.wear.body", SCS_VALUE_TYPE_float, StoreFloat, &s.trailerWearBody);
  Channel("trailer.0.wear.chassis", SCS_VALUE_TYPE_float, StoreFloat, &s.trailerWearChassis);
  Channel("trailer.0.wear.wheels", SCS_VALUE_TYPE_float, StoreFloat, &s.trailerWearWheels);
  Channel("trailer.0.cargo.damage", SCS_VALUE_TYPE_float, StoreFloat, &s.trailerCargoDamage);
  Channel(SCS_TELEMETRY_JOB_CHANNEL_cargo_damage, SCS_VALUE_TYPE_float, StoreFloat, &s.jobCargoDamage);
}

// ---- configuration ----

std::string AttrString(const scs_value_t& v) {
  switch (v.type) {
    case SCS_VALUE_TYPE_string: return v.value_string.value ? v.value_string.value : "";
    case SCS_VALUE_TYPE_u32: return std::to_string(v.value_u32.value);
    case SCS_VALUE_TYPE_s32: return std::to_string(v.value_s32.value);
    case SCS_VALUE_TYPE_u64: return std::to_string(v.value_u64.value);
    default: return {};
  }
}

double AttrNumber(const scs_value_t& v) {
  switch (v.type) {
    case SCS_VALUE_TYPE_float: return v.value_float.value;
    case SCS_VALUE_TYPE_double: return v.value_double.value;
    case SCS_VALUE_TYPE_u32: return v.value_u32.value;
    case SCS_VALUE_TYPE_s32: return v.value_s32.value;
    case SCS_VALUE_TYPE_u64: return static_cast<double>(v.value_u64.value);
    case SCS_VALUE_TYPE_s64: return static_cast<double>(v.value_s64.value);
    case SCS_VALUE_TYPE_bool: return v.value_bool.value ? 1 : 0;
    default: return 0;
  }
}

bool Is(const scs_named_value_t* a, const char* name) { return a->index == SCS_U32_NIL && !strcmp(a->name, name); }

SCSAPI_VOID OnConfiguration(const scs_event_t, const void* const info, const scs_context_t) {
  const auto* cfg = static_cast<const scs_telemetry_configuration_t*>(info);
  State& s = g_work;
  const char* id = cfg->id;
  const bool empty = cfg->attributes->name == nullptr;

  if (!strcmp(id, SCS_TELEMETRY_CONFIG_truck)) {
    s.hasTruck = !empty;
    s.brand = s.brandId = s.truckName = s.truckId = s.plate = s.plateCountry = "";
    s.fuelCapacity = s.adblueCapacity = s.rpmLimit = s.airWarnLevel = 0;
    s.gearsForward = s.gearsReverse = s.retarderSteps = 0;
    s.hasHead = false;
    for (const scs_named_value_t* a = cfg->attributes; a->name; ++a) {
      if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_head_position) && a->value.type == SCS_VALUE_TYPE_fvector) {
        s.headX = a->value.value_fvector.x;
        s.headY = a->value.value_fvector.y;
        s.headZ = a->value.value_fvector.z;
        s.hasHead = true;
      }
      if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_brand)) s.brand = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_brand_id)) s.brandId = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_name)) s.truckName = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_id)) s.truckId = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_license_plate)) s.plate = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_license_plate_country)) s.plateCountry = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_fuel_capacity)) s.fuelCapacity = static_cast<float>(AttrNumber(a->value));
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_adblue_capacity)) s.adblueCapacity = static_cast<float>(AttrNumber(a->value));
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_rpm_limit)) s.rpmLimit = static_cast<float>(AttrNumber(a->value));
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_air_pressure_warning)) s.airWarnLevel = static_cast<float>(AttrNumber(a->value));
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_forward_gear_count)) s.gearsForward = static_cast<scs_u32_t>(AttrNumber(a->value));
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_reverse_gear_count)) s.gearsReverse = static_cast<scs_u32_t>(AttrNumber(a->value));
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_retarder_step_count)) s.retarderSteps = static_cast<scs_u32_t>(AttrNumber(a->value));
    }
    TPLOG("config truck: %s %s (%s), head at %.2f %.2f %.2f", s.brand.c_str(), s.truckName.c_str(), s.truckId.c_str(),
          s.headX, s.headY, s.headZ);
  } else if (!strcmp(id, "trailer.0") || !strcmp(id, SCS_TELEMETRY_CONFIG_trailer)) {
    s.hasTrailer = !empty;
    s.trailerName = s.trailerBrand = s.trailerPlate = s.trailerCargoAccessory = "";
    for (const scs_named_value_t* a = cfg->attributes; a->name; ++a) {
      if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_name)) s.trailerName = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_brand)) s.trailerBrand = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_license_plate)) s.trailerPlate = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_cargo_accessory_id)) s.trailerCargoAccessory = AttrString(a->value);
    }
  } else if (!strcmp(id, SCS_TELEMETRY_CONFIG_job)) {
    s.hasJob = !empty;
    s.cargo = s.cargoId = s.srcCity = s.srcCityId = s.srcCompany = s.srcCompanyId = "";
    s.dstCity = s.dstCityId = s.dstCompany = s.dstCompanyId = s.jobMarket = "";
    s.cargoMass = 0;
    s.income = 0;
    s.deliveryTime = s.plannedKm = 0;
    s.cargoLoaded = s.specialJob = false;
    for (const scs_named_value_t* a = cfg->attributes; a->name; ++a) {
      if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_cargo)) s.cargo = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_cargo_id)) s.cargoId = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_cargo_mass)) s.cargoMass = static_cast<float>(AttrNumber(a->value));
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_source_city)) s.srcCity = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_source_city_id)) s.srcCityId = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_source_company)) s.srcCompany = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_source_company_id)) s.srcCompanyId = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_destination_city)) s.dstCity = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_destination_city_id)) s.dstCityId = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_destination_company)) s.dstCompany = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_destination_company_id)) s.dstCompanyId = AttrString(a->value);
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_income)) s.income = static_cast<scs_u64_t>(AttrNumber(a->value));
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_delivery_time)) s.deliveryTime = static_cast<scs_u32_t>(AttrNumber(a->value));
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_planned_distance_km)) s.plannedKm = static_cast<scs_u32_t>(AttrNumber(a->value));
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_is_cargo_loaded)) s.cargoLoaded = AttrNumber(a->value) != 0;
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_special_job)) s.specialJob = AttrNumber(a->value) != 0;
      else if (Is(a, SCS_TELEMETRY_CONFIG_ATTRIBUTE_job_market)) s.jobMarket = AttrString(a->value);
    }
    TPLOG("config job: %s %s -> %s", s.cargo.c_str(), s.srcCity.c_str(), s.dstCity.c_str());
  }
}

// ---- gameplay events ----

SCSAPI_VOID OnGameplay(const scs_event_t, const void* const info, const scs_context_t) {
  const auto* ev = static_cast<const scs_telemetry_gameplay_event_t*>(info);
  JsonWriter w;
  w.beginObject().str("t", "ev").str("id", ev->id).beginObject("a");
  for (const scs_named_value_t* a = ev->attributes; a->name; ++a) {
    switch (a->value.type) {
      case SCS_VALUE_TYPE_string: w.str(a->name, AttrString(a->value)); break;
      case SCS_VALUE_TYPE_bool: w.boolean(a->name, a->value.value_bool.value != 0); break;
      default: w.num(a->name, AttrNumber(a->value), 12);
    }
  }
  w.endObject().endObject();
  TPLOG("event %s", ev->id);
  std::lock_guard lock(g_mu);
  if (g_events.size() < 64) g_events.push_back(w.text());
}

SCSAPI_VOID OnPausedOrStarted(const scs_event_t event, const void* const, const scs_context_t) {
  g_work.paused = event == SCS_TELEMETRY_EVENT_paused;
  std::lock_guard lock(g_mu);
  g_published.paused = g_work.paused;
}

SCSAPI_VOID OnFrameEnd(const scs_event_t, const void* const, const scs_context_t) {
  std::lock_guard lock(g_mu);
  g_published = g_work;
}

void Pos(JsonWriter& w, const char* key, const Placement& p) {
  w.beginObject(key)
      .num("x", p.x, 10)
      .num("y", p.y, 8)
      .num("z", p.z, 10)
      .num("h", p.heading, 6)
      .num("p", p.pitch, 4)
      .num("r", p.roll, 4)
      .endObject();
}

}  // namespace

std::atomic<bool> g_inited{false};  // the game started the telemetry (not so in the test cab)

bool TelemetryInit(const scs_telemetry_init_params_v100_t* params) {
  g_params = *params;
  g_inited = true;
  const scs_u32_t gv = params->common.game_version;
  char ver[32];
  snprintf(ver, sizeof ver, "%u.%02u", SCS_GET_MAJOR_VERSION(gv), SCS_GET_MINOR_VERSION(gv));
  g_sdkVersion = ver;
  TPLOG("telemetry: game '%s' (%s), telemetry game version %s", params->common.game_name, params->common.game_id, ver);

  const bool events =
      params->register_for_event(SCS_TELEMETRY_EVENT_frame_end, OnFrameEnd, nullptr) == SCS_RESULT_ok &&
      params->register_for_event(SCS_TELEMETRY_EVENT_paused, OnPausedOrStarted, nullptr) == SCS_RESULT_ok &&
      params->register_for_event(SCS_TELEMETRY_EVENT_started, OnPausedOrStarted, nullptr) == SCS_RESULT_ok;
  if (!events) {
    TPLOG("telemetry: event registration failed");
    return false;
  }
  params->register_for_event(SCS_TELEMETRY_EVENT_configuration, OnConfiguration, nullptr);
  params->register_for_event(SCS_TELEMETRY_EVENT_gameplay, OnGameplay, nullptr);
  RegisterChannels();
  return true;
}

void TelemetryShutdown() {}

std::string TelemetrySdkVersion() { return g_sdkVersion; }

bool TelemetryPaused() {
  std::lock_guard lock(g_mu);
  // Without the game's telemetry (the test cab) nothing is ever paused.
  return g_inited && g_published.paused;
}

bool TelemetryHead(HeadPose* out) {
  std::lock_guard lock(g_mu);
  if (!g_inited || !g_published.hasHead) return false;
  const State& s = g_published;
  *out = {s.headX, s.headY, s.headZ, s.headOffset.x, s.headOffset.y, s.headOffset.z,
          s.headOffset.heading, s.headOffset.pitch, s.headOffset.roll};
  return true;
}

std::vector<std::string> TelemetryDrainEvents() {
  std::lock_guard lock(g_mu);
  std::vector<std::string> out;
  out.swap(g_events);
  return out;
}

std::string TelemetryJson() {
  State s;
  {
    std::lock_guard lock(g_mu);
    s = g_published;
  }
  JsonWriter w;
  w.beginObject().str("t", "tel").boolean("paused", s.paused);
  w.beginObject("game")
      .integer("time", s.gameTime)
      .integer("rest", s.restStop)
      .integer("brk", s.mandatoryBreak)
      .num("scale", s.localScale)
      .integer("mp", s.mpTimeOffset)
      .endObject();

  w.beginObject("truck").boolean("on", s.hasTruck);
  w.str("brand", s.brand).str("brandId", s.brandId).str("name", s.truckName).str("id", s.truckId);
  w.str("plate", s.plate).str("plateCountry", s.plateCountry);
  w.num("speed", s.speed).num("rpm", s.rpm).num("rpmMax", s.rpmLimit).integer("gear", s.gear).integer("dgear", s.displayedGear);
  w.integer("gearsF", s.gearsForward).integer("gearsR", s.gearsReverse);
  w.num("cruise", s.cruise).num("steer", s.steering).num("throttle", s.throttle).num("brake", s.brake).num("clutch", s.clutch);
  w.num("fuel", s.fuel).num("fuelCap", s.fuelCapacity).num("fuelRange", s.fuelRange).num("fuelAvg", s.fuelAvg).boolean("fuelWarn", s.fuelWarn);
  w.num("adblue", s.adblue).num("adblueCap", s.adblueCapacity).boolean("adblueWarn", s.adblueWarn);
  w.num("air", s.airPressure).num("airWarnAt", s.airWarnLevel).boolean("airWarn", s.airWarn).boolean("airEmg", s.airEmergency);
  w.num("brakeT", s.brakeTemp).num("oilP", s.oilPressure).boolean("oilWarn", s.oilWarn).num("oilT", s.oilTemp);
  w.num("waterT", s.waterTemp).boolean("waterWarn", s.waterWarn).num("batt", s.battery).boolean("battWarn", s.batteryWarn);
  w.boolean("electric", s.electric).boolean("engine", s.engine).boolean("pbrake", s.parkingBrake).boolean("mbrake", s.motorBrake);
  w.integer("retarder", s.retarder).integer("retarderSteps", s.retarderSteps);
  w.beginObject("lights")
      .boolean("lBlink", s.lBlinkLight)
      .boolean("rBlink", s.rBlinkLight)
      .boolean("lInd", s.lBlinker)
      .boolean("rInd", s.rBlinker)
      .boolean("hazard", s.hazard)
      .boolean("parking", s.parkingLight)
      .boolean("low", s.lowBeam)
      .boolean("high", s.highBeam)
      .boolean("beacon", s.beacon)
      .boolean("brake", s.brakeLight)
      .boolean("reverse", s.reverseLight)
      .integer("auxF", s.auxFront)
      .integer("auxR", s.auxRoof)
      .endObject();
  w.boolean("wipers", s.wipers).boolean("diffLock", s.diffLock).num("backlight", s.backlight).num("odo", s.odometer, 9);
  w.beginObject("wear")
      .num("engine", s.wearEngine)
      .num("trans", s.wearTransmission)
      .num("cabin", s.wearCabin)
      .num("chassis", s.wearChassis)
      .num("wheels", s.wearWheels)
      .endObject();
  w.beginObject("nav").num("dist", s.navDistance, 9).num("time", s.navTime, 9).num("limit", s.navSpeedLimit).endObject();
  Pos(w, "pos", s.truckPos);
  w.endObject();

  w.beginObject("trailer")
      .boolean("on", s.hasTrailer)
      .boolean("attached", s.trailerConnected)
      .str("name", s.trailerName)
      .str("brand", s.trailerBrand)
      .str("plate", s.trailerPlate)
      .num("cargoDamage", s.trailerCargoDamage);
  w.beginObject("wear").num("body", s.trailerWearBody).num("chassis", s.trailerWearChassis).num("wheels", s.trailerWearWheels).endObject();
  Pos(w, "pos", s.trailerPos);
  w.endObject();

  w.beginObject("job").boolean("on", s.hasJob);
  w.str("cargo", s.cargo).str("cargoId", s.cargoId).num("mass", s.cargoMass).num("damage", s.jobCargoDamage);
  w.integer("income", static_cast<long long>(s.income)).integer("due", s.deliveryTime).integer("plannedKm", s.plannedKm);
  w.boolean("loaded", s.cargoLoaded).boolean("special", s.specialJob).str("market", s.jobMarket);
  w.beginObject("src").str("city", s.srcCity).str("cityId", s.srcCityId).str("company", s.srcCompany).str("companyId", s.srcCompanyId).endObject();
  w.beginObject("dst").str("city", s.dstCity).str("cityId", s.dstCityId).str("company", s.dstCompany).str("companyId", s.dstCompanyId).endObject();
  w.endObject();

  w.endObject();
  return w.text();
}

}  // namespace tp
