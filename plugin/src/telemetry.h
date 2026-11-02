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
std::string TelemetrySdkVersion();

// Where the driver's eyes are: the head's default position in the cabin (metres, cabin space: x
// right, y up, z back) and its offset from there right now — moved and turned as the driver looks
// around or picks a camera preset. Angles in the SDK's unit range (1 = a full turn): heading
// counterclockwise from above, pitch up. False before the game has told us (and in the test cab).
struct HeadPose {
  float x = 0, y = 0, z = 0;              // default position
  float dx = 0, dy = 0, dz = 0;           // offset
  float heading = 0, pitch = 0, roll = 0; // offset
};
bool TelemetryHead(HeadPose* out);

}  // namespace tp
