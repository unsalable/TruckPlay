#pragma once
#include <string>
#include <vector>

struct scs_telemetry_init_params_v100_t;

namespace tp {

// Registers channels and events with the game. Returns false if registration failed.
bool TelemetryInit(const scs_telemetry_init_params_v100_t* params);
void TelemetryShutdown();

// Latest published frame as a `tel` message (thread-safe).
std::string TelemetryJson();
// Gameplay events since the last call, each a complete `ev` message.
std::vector<std::string> TelemetryDrainEvents();
bool TelemetryPaused();
// What is left of the game's GPS route, in metres (0 without one).
float TelemetryNavDistance();
std::string TelemetrySdkVersion();


}  // namespace tp
