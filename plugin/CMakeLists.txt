cmake_minimum_required(VERSION 3.20)
project(truckplay LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

set(SCS_SDK ${CMAKE_CURRENT_SOURCE_DIR}/../tools/scs_sdk_1_16/sdk/include)

add_library(truckplay SHARED
  src/plugin.cpp
  src/log.cpp
  src/telemetry.cpp
  src/pipe.cpp
  src/frames.cpp
  src/d3d_hooks.cpp
  src/gamedraw.cpp
  src/input.cpp
  src/overlay.cpp
  src/pointer.cpp
  src/truckplay.def
)
target_include_directories(truckplay PRIVATE ${SCS_SDK} src)
target_compile_definitions(truckplay PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _CRT_SECURE_NO_WARNINGS)
target_compile_options(truckplay PRIVATE /W4 /permissive- /utf-8 /EHsc /wd4100 /wd4644)
target_link_libraries(truckplay PRIVATE d3d11 dxgi d3dcompiler dinput8 dxguid user32 version)

# The host's helper for Windows media sessions (Spotify, Apple Music, browsers), C++/WinRT.
add_executable(truckplay-media media/media.cpp)
target_compile_definitions(truckplay-media PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _CRT_SECURE_NO_WARNINGS)
target_compile_options(truckplay-media PRIVATE /W3 /permissive- /utf-8 /EHsc /bigobj)
target_link_libraries(truckplay-media PRIVATE windowsapp version)

add_executable(hooktest test/hooktest.cpp)
target_compile_definitions(hooktest PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(hooktest PRIVATE /W4 /permissive- /utf-8 /EHsc)
target_link_libraries(hooktest PRIVATE d3d11 dxgi user32)

add_executable(testcab test/testcab.cpp)
target_compile_definitions(testcab PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _CRT_SECURE_NO_WARNINGS)
target_compile_options(testcab PRIVATE /W4 /permissive- /utf-8 /EHsc)
target_link_libraries(testcab PRIVATE d3d11 dxgi d3dcompiler user32 ole32 windowscodecs)

add_executable(testhost test/testhost.cpp)
target_compile_definitions(testhost PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(testhost PRIVATE /W4 /permissive- /utf-8 /EHsc)

# The one-file installer (TruckPlay-Kurulum.exe is this program with the app appended, see
# scripts/paket.mjs) and the tool that gives TruckPlay.exe its icon.
add_executable(truckplay-setup setup/setup.cpp setup/setup.rc)
target_compile_definitions(truckplay-setup PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _CRT_SECURE_NO_WARNINGS)
target_compile_options(truckplay-setup PRIVATE /W4 /permissive- /utf-8 /EHsc)

add_executable(seticon setup/seticon.cpp)
target_compile_definitions(seticon PRIVATE UNICODE _UNICODE NOMINMAX _CRT_SECURE_NO_WARNINGS)
target_compile_options(seticon PRIVATE /W4 /permissive- /utf-8 /EHsc)
