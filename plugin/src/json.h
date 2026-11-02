#pragma once
// Just enough JSON for the pipe: a streaming writer and field lookups for the host's flat messages.

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace tp {

class JsonWriter {
 public:
  JsonWriter& beginObject(const char* key = nullptr) {
    sep(key);
    s_ += '{';
    first_ = true;
    return *this;
  }
  JsonWriter& endObject() {
    s_ += '}';
    first_ = false;
    return *this;
  }
  JsonWriter& str(const char* key, const std::string& v) {
    sep(key);
    quote(v);
    return *this;
  }
  JsonWriter& num(const char* key, double v, int precision = 6) {
    sep(key);
    if (!std::isfinite(v)) {
      s_ += '0';
      return *this;
    }
    char b[40];
    snprintf(b, sizeof b, "%.*g", precision, v);
    s_ += b;
    return *this;
  }
  JsonWriter& integer(const char* key, long long v) {
    sep(key);
    s_ += std::to_string(v);
    return *this;
  }
  JsonWriter& boolean(const char* key, bool v) {
    sep(key);
    s_ += v ? "true" : "false";
    return *this;
  }
  // Inserts an already-serialised JSON value.
  JsonWriter& raw(const char* key, const std::string& json) {
    sep(key);
    s_ += json;
    return *this;
  }
  const std::string& text() const { return s_; }

 private:
  void sep(const char* key) {
    if (!first_) s_ += ',';
    first_ = false;
    if (key) {
      quote(key);
      s_ += ':';
    }
  }
  void quote(const std::string& v) {
    s_ += '"';
    for (const unsigned char c : v) {
      switch (c) {
        case '"': s_ += "\\\""; break;
        case '\\': s_ += "\\\\"; break;
        case '\n': s_ += "\\n"; break;
        case '\r': s_ += "\\r"; break;
        case '\t': s_ += "\\t"; break;
        default:
          if (c < 0x20) {
            char b[8];
            snprintf(b, sizeof b, "\\u%04x", c);
            s_ += b;
          } else {
            s_ += static_cast<char>(c);
          }
      }
    }
    s_ += '"';
  }
  std::string s_;
  bool first_ = true;
};

// Field lookups for flat objects such as {"t":"cfg","holdVk":71}. Not a general parser.
// A key is a quoted name followed by a colon: in {"t":"cmd","cmd":"pause"} the value "cmd" is not
// the key "cmd".
inline const char* JsonFind(const std::string& json, const char* key) {
  const std::string needle = std::string("\"") + key + "\"";
  for (size_t at = json.find(needle); at != std::string::npos; at = json.find(needle, at + 1)) {
    size_t p = at + needle.size();
    while (p < json.size() && (json[p] == ' ' || json[p] == '\t')) ++p;
    if (p >= json.size() || json[p] != ':') continue;
    ++p;
    while (p < json.size() && (json[p] == ' ' || json[p] == '\t')) ++p;
    return json.c_str() + p;
  }
  return nullptr;
}

inline std::string JsonString(const std::string& json, const char* key) {
  const char* p = JsonFind(json, key);
  if (!p || *p != '"') return {};
  std::string out;
  for (++p; *p && *p != '"'; ++p) {
    if (*p == '\\' && p[1]) ++p;
    out += *p;
  }
  return out;
}

inline double JsonNumber(const std::string& json, const char* key, double fallback) {
  const char* p = JsonFind(json, key);
  if (!p) return fallback;
  char* end = nullptr;
  const double v = strtod(p, &end);
  return end == p ? fallback : v;
}

// A flat array of numbers or of strings, e.g. "pids":[12,34] or "apps":["a.exe"].
inline std::vector<double> JsonNumbers(const std::string& json, const char* key) {
  std::vector<double> out;
  const char* p = JsonFind(json, key);
  if (!p || *p != '[') return out;
  for (++p; *p && *p != ']';) {
    char* end = nullptr;
    const double v = strtod(p, &end);
    if (end == p) {
      ++p;
      continue;
    }
    out.push_back(v);
    p = end;
  }
  return out;
}

inline std::vector<std::string> JsonStrings(const std::string& json, const char* key) {
  std::vector<std::string> out;
  const char* p = JsonFind(json, key);
  if (!p || *p != '[') return out;
  for (++p; *p && *p != ']'; ++p) {
    if (*p != '"') continue;
    std::string s;
    for (++p; *p && *p != '"'; ++p) {
      if (*p == '\\' && p[1]) ++p;
      s += *p;
    }
    out.push_back(s);
    if (!*p) break;
  }
  return out;
}

inline bool JsonBool(const std::string& json, const char* key, bool fallback) {
  const char* p = JsonFind(json, key);
  if (!p) return fallback;
  if (!strncmp(p, "true", 4)) return true;
  if (!strncmp(p, "false", 5)) return false;
  return fallback;
}

}  // namespace tp
