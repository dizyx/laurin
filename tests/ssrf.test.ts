/**
 * Tests for SSRF protection and DNS pinning.
 */
import { describe, test, expect } from "bun:test"
import { checkSsrf, ipToInt, ipMatchesCidr, DENIED_CIDRS, TAILSCALE_CIDR } from "../src/proxy/ssrf-guard.ts"

describe("ipToInt", () => {
  test("converts valid IPv4 to integer", () => {
    expect(ipToInt("0.0.0.0")).toBe(0)
    expect(ipToInt("255.255.255.255")).toBe(0xffffffff)
    expect(ipToInt("10.0.0.1")).toBe(0x0a000001)
    expect(ipToInt("169.254.169.254")).toBe(0xa9fea9fe)
    expect(ipToInt("127.0.0.1")).toBe(0x7f000001)
    expect(ipToInt("192.168.1.100")).toBe(0xc0a80164)
  })

  test("returns null for invalid IPs", () => {
    expect(ipToInt("not-an-ip")).toBeNull()
    expect(ipToInt("256.0.0.0")).toBeNull()
    expect(ipToInt("1.2.3")).toBeNull()
    expect(ipToInt("1.2.3.4.5")).toBeNull()
    expect(ipToInt("")).toBeNull()
  })
})

describe("ipMatchesCidr", () => {
  test("matches IPs within CIDR ranges", () => {
    // 10.0.0.0/8
    const cidr10 = DENIED_CIDRS.find((c) => c.label.includes("10.0.0.0"))!
    expect(ipMatchesCidr(ipToInt("10.0.0.1")!, cidr10.network, cidr10.mask)).toBe(true)
    expect(ipMatchesCidr(ipToInt("10.255.255.255")!, cidr10.network, cidr10.mask)).toBe(true)
    expect(ipMatchesCidr(ipToInt("11.0.0.1")!, cidr10.network, cidr10.mask)).toBe(false)

    // 192.168.0.0/16
    const cidr192 = DENIED_CIDRS.find((c) => c.label.includes("192.168.0.0"))!
    expect(ipMatchesCidr(ipToInt("192.168.1.1")!, cidr192.network, cidr192.mask)).toBe(true)
    expect(ipMatchesCidr(ipToInt("192.169.0.1")!, cidr192.network, cidr192.mask)).toBe(false)
  })

  test("matches Tailscale CIDR", () => {
    expect(ipMatchesCidr(ipToInt("100.64.0.1")!, TAILSCALE_CIDR.network, TAILSCALE_CIDR.mask)).toBe(true)
    expect(ipMatchesCidr(ipToInt("100.127.255.255")!, TAILSCALE_CIDR.network, TAILSCALE_CIDR.mask)).toBe(true)
    expect(ipMatchesCidr(ipToInt("100.128.0.0")!, TAILSCALE_CIDR.network, TAILSCALE_CIDR.mask)).toBe(false)
  })
})

describe("checkSsrf", () => {
  test("allows normal public URLs", async () => {
    const result = await checkSsrf("https://api.github.com/repos/dizyx/laurin")
    expect(result.allowed).toBe(true)
  })

  test("allows httpbin.org", async () => {
    const result = await checkSsrf("https://httpbin.org/get")
    expect(result.allowed).toBe(true)
  })

  // Direct IP tests
  test("blocks cloud metadata endpoint (169.254.169.254)", async () => {
    const result = await checkSsrf("http://169.254.169.254/latest/meta-data/")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("cloud-metadata")
  })

  test("blocks loopback (127.0.0.1)", async () => {
    const result = await checkSsrf("http://127.0.0.1:8080/steal")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("loopback")
  })

  test("blocks loopback (127.0.0.2)", async () => {
    const result = await checkSsrf("http://127.0.0.2/steal")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("loopback")
  })

  test("blocks RFC1918 10.x.x.x", async () => {
    const result = await checkSsrf("http://10.0.0.1/internal")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("RFC1918")
  })

  test("blocks RFC1918 172.16.x.x", async () => {
    const result = await checkSsrf("http://172.16.0.1/internal")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("RFC1918")
  })

  test("blocks RFC1918 192.168.x.x", async () => {
    const result = await checkSsrf("http://192.168.1.1/router")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("RFC1918")
  })

  test("blocks Tailscale IPs by default", async () => {
    const result = await checkSsrf("http://100.112.204.112:3500/api")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Tailscale")
  })

  test("allows Tailscale IPs when allowTailscale=true", async () => {
    const result = await checkSsrf("http://100.112.204.112:3500/api", true)
    expect(result.allowed).toBe(true)
  })

  test("blocks link-local range", async () => {
    const result = await checkSsrf("http://169.254.1.1/something")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("link-local")
  })

  test("rejects invalid URLs", async () => {
    const result = await checkSsrf("not-a-url")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Invalid URL")
  })

  // DNS-based test: localhost should resolve to 127.0.0.1 and be blocked
  test("blocks DNS names that resolve to blocked IPs (localhost)", async () => {
    const result = await checkSsrf("http://localhost:8080/steal")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("loopback")
  })
})
