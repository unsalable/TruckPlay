#pragma once
#include <functional>
#include <string>
#include <vector>

namespace tp::pipe {

// Server for \\.\pipe\tirplay. Lines in both directions are JSON objects.
void Start(std::function<void(const std::string&)> onMessage, std::function<std::vector<std::string>()> onConnect);
void Stop();
// Queue a line for the host (thread-safe). Dropped while no host is connected.
void Send(std::string line);
bool Connected();

}  // namespace tp::pipe
