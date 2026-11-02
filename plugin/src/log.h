#pragma once
#include <string>

namespace tp {

// Log file lives next to the plugin: <plugins>\truckplay\truckplay.log
void LogInit();
void LogClose();
void Log(const char* fmt, ...);
std::wstring PluginDataDir();

}  // namespace tp

#define TPLOG(...) ::tp::Log(__VA_ARGS__)
