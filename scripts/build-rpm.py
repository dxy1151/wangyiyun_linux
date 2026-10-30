#!/usr/bin/env python3
"""
纯 Python RPM 打包器（不依赖 rpmbuild / rpm 二进制）

用途：在 Debian/Ubuntu 环境下为 Electron 应用生成可安装的 .rpm，
      避免引入 rpmbuild + 原生依赖（lib sequoia 等）。

实现依据 RPM 包格式规范：
  [Lead 96B][Signature Header][Main Header][CPIO payload(.cpio.gz)]
CPIO 使用 newc 格式；头部使用 tag/type/offset/count 的索引结构。

用法：
  python3 scripts/build-rpm.py --srcdir release/linux-unpacked \
      --name netease-cloud-music --version 1.0.0 --release 1 \
      --out release/netease-cloud-music-1.0.0.x86_64.rpm
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import os
import stat
import struct
import sys
import time

# ---------------------------------------------------------------- RPM 常量

RPMTAG_HEADERI18NTABLE = 100
RPMTAG_NAME = 1000
RPMTAG_VERSION = 1001
RPMTAG_RELEASE = 1002
RPMTAG_SUMMARY = 1004
RPMTAG_DESCRIPTION = 1005
RPMTAG_BUILDTIME = 1006
RPMTAG_BUILDHOST = 1007
RPMTAG_SIZE = 1009
RPMTAG_VENDOR = 1011
RPMTAG_LICENSE = 1014
RPMTAG_PACKAGER = 1015
RPMTAG_GROUP = 1016
RPMTAG_URL = 1020
RPMTAG_OS = 1021
RPMTAG_ARCH = 1022
RPMTAG_PREIN = 1023
RPMTAG_POSTIN = 1024
RPMTAG_FILESIZES = 1028
RPMTAG_FILEMODES = 1030
RPMTAG_FILERDEVS = 1033
RPMTAG_FILEMTIMES = 1034
RPMTAG_FILEDIGESTS = 1035
RPMTAG_FILELINKTOS = 1036
RPMTAG_FILEFLAGS = 1037
RPMTAG_FILEUSERNAME = 1039
RPMTAG_FILEGROUPNAME = 1040
RPMTAG_SOURCERPM = 1044
RPMTAG_FILEVERIFYFLAGS = 1045
RPMTAG_ARCHIVESIZE = 1046
RPMTAG_PROVIDENAME = 1047
RPMTAG_REQUIREFLAGS = 1048
RPMTAG_REQUIRENAME = 1049
RPMTAG_REQUIREVERSION = 1050
RPMTAG_RPMVERSION = 1064
RPMTAG_CHANGELOGTIME = 1080
RPMTAG_CHANGELOGNAME = 1081
RPMTAG_CHANGELOGTEXT = 1082
RPMTAG_COOKIE = 1094
RPMTAG_FILEINODES = 1096
RPMTAG_FILELANGS = 1097
RPMTAG_PROVIDEFLAGS = 1112
RPMTAG_PROVIDEVERSION = 1113
RPMTAG_DIRINDEXES = 1116
RPMTAG_BASENAMES = 1117
RPMTAG_DIRNAMES = 1118
RPMTAG_OPTFLAGS = 1122
RPMTAG_PAYLOADFORMAT = 1124
RPMTAG_PAYLOADCOMPRESSOR = 1125
RPMTAG_PAYLOADFLAGS = 1126
RPMTAG_PLATFORM = 1132
RPMTAG_FILECAPS = 5010  # 非标准，忽略

# Signature header tags
SIG_DSA = 267
SIG_RSA = 268
SIG_SHA1 = 269
SIG_LONGSIZE = 270
SIG_LONGARCHIVESIZE = 271
SIG_SHA256 = 273
SIG_SIZE = 1000
SIG_MD5 = 1004
SIG_PAYLOADSIZE = 1007
SIG_PAYLOADDIGEST = 5092
SIG_PAYLOADDIGESTALT = 5097

RPM_LEAD_MAGIC = b"\xed\xab\xee\xdb"

INT8, INT16, INT32, INT64, STRING, BIN, I18NSTRING = (1, 2, 4, 8, 6, 7, 9)
# 注意：RPM 中 STRING_ARRAY 与 INT64 的 type 数值同为 8，
# 但 STRING_ARRAY 的对齐粒度是 1 字节，INT64 是 8 字节，必须分开处理。
STRING_ARRAY = 8


# ------------------------------------------------------------------ 帮助函数

def align(v: int, a: int) -> int:
    return v + ((a - (v % a)) % a)


class HeaderEntry:
    __slots__ = ("tag", "type", "data", "count", "align")

    def __init__(self, tag: int, typ: int, data, count: int = 1, align: int = -1):
        self.tag, self.type, self.data, self.count = tag, typ, data, count
        # align = -1 表示按 type 推导；STRING_ARRAY(8) 与 INT64(8) 数值相同但对齐不同
        self.align = align


def hdr_entry_string(tag: int, value: str) -> HeaderEntry:
    return HeaderEntry(tag, STRING, value.encode("utf-8") + b"\0", 1)


def hdr_entry_i18nstring(tag: int, value: str) -> HeaderEntry:
    """I18NSTRING(type=9)：取 locale 表第 0 项（"C"）的翻译。"""
    return HeaderEntry(tag, I18NSTRING, value.encode("utf-8") + b"\0", 1)


def hdr_entry_string_array(tag: int, values) -> HeaderEntry:
    data = b"".join(v.encode("utf-8") + b"\0" for v in values)
    return HeaderEntry(tag, STRING_ARRAY, data, len(values), align=1)


def hdr_entry_int32(tag: int, values) -> HeaderEntry:
    if not isinstance(values, (list, tuple)):
        values = [values]
    data = b"".join(struct.pack(">I", v & 0xFFFFFFFF) for v in values)
    return HeaderEntry(tag, INT32, data, len(values))


def hdr_entry_int16(tag: int, values) -> HeaderEntry:
    if not isinstance(values, (list, tuple)):
        values = [values]
    data = b"".join(struct.pack(">H", v & 0xFFFF) for v in values)
    return HeaderEntry(tag, INT16, data, len(values))


def hdr_entry_int64(tag: int, values) -> HeaderEntry:
    if not isinstance(values, (list, tuple)):
        values = [values]
    data = b"".join(struct.pack(">Q", v & 0xFFFFFFFFFFFFFFFF) for v in values)
    return HeaderEntry(tag, INT64, data, len(values))


def build_header(entries: list[HeaderEntry]) -> bytes:
    """构造一段 header（signature 与 main header 共用格式）。

    返回的字节流**不含**尾部对齐填充；对齐由调用方在拼接时处理。
    RPM 的 hsize 字段只统计 data store 长度，不含索引与头部。
    """
    # RPM header 布局：
    #   [magic(4) reserved(4) nindex(4) hsize(4)] [index: n * 16B] [data store]
    # index 里的 offset 是「相对 data store 起点」的偏移。
    # RPM 要求索引按 tag 升序排列（rpm 读取端假定有序，否则 hdr load BAD）
    entries = sorted(entries, key=lambda e: e.tag)
    n = len(entries)
    data_region = bytearray()
    index = bytearray()

    for e in entries:
        # 每个 entry 的数据必须按其类型对齐（INT32 4B / INT64 8B / 字符串 1B）
        align_to = e.align if e.align > 0 else {INT16: 2, INT32: 4, INT64: 8}.get(e.type, 1)
        data_region += b"\0" * ((align_to - (len(data_region) % align_to)) % align_to)
        offset = len(data_region)
        index += struct.pack(">IIII", e.tag, e.type, offset, e.count)
        data_region += e.data

    index_bytes = b"\x8e\xad\xe8\x01" + b"\0\0\0\0" + struct.pack(">II", n, len(data_region))
    return index_bytes + bytes(index) + bytes(data_region)


# ------------------------------------------------------------------ CPIO

def _cpio_entry(name: str, data: bytes | None, mode: int, mtime: int, size: int = 0) -> bytes:
    """构造 newc 格式 cpio 条目。"""
    name_bytes = name.encode("utf-8") + b"\0"
    if data is not None:
        size = len(data)
    hdr = "070701"
    ino = 0
    nlink = 1
    values = [
        ino, mode, 0, 0, nlink, mtime, size,
        0, 0, 0, 0,           # devmajor, devminor, rdevmajor, rdevminor
        len(name_bytes), 0,
    ]
    head = (hdr + "".join(f"{v:08x}" for v in values)).encode("ascii")
    head += name_bytes
    head += b"\0" * ((4 - (len(head) % 4)) % 4)
    out = head
    if data is not None:
        out += data
        out += b"\0" * ((4 - (len(out) % 4)) % 4)
    return out


def cpio_trailer(mtime: int) -> bytes:
    return _cpio_entry("TRAILER!!!", b"", 0, mtime, 0)


# ------------------------------------------------------------------ 主流程

def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--srcdir", required=True, help="要打包的目录树（会成为安装根 /）")
    ap.add_argument("--name", default="netease-cloud-music")
    ap.add_argument("--version", default="1.0.0")
    ap.add_argument("--release", default="1")
    ap.add_argument("--arch", default="x86_64")
    ap.add_argument("--summary", default="NetEase Cloud Music client for Linux")
    ap.add_argument("--description", default="Unofficial NetEase Cloud Music desktop client for Linux, built with Electron + React.")
    ap.add_argument("--license", default="MIT")
    ap.add_argument("--url", default="https://github.com/dxy1151/wangyiyun_linux")
    ap.add_argument("--out", required=True)
    # 额外文件：rpm 里的路径 -> 源文件路径（用于 desktop 文件、图标等）
    ap.add_argument("--extra", action="append", default=[], metavar="DEST=SRC")
    ap.add_argument("--postin", default="")
    args = ap.parse_args()

    srcdir = os.path.abspath(args.srcdir)
    buildtime = int(time.time())

    # 收集文件：路径 -> (源文件绝对路径, 模式)
    files: dict[str, tuple[str, int]] = {}

    for root, dirs, names in os.walk(srcdir):
        dirs.sort()
        names.sort()
        for nm in names:
            src = os.path.join(root, nm)
            if os.path.islink(src):
                continue
            rel = os.path.relpath(src, srcdir)
            dest = "/usr/lib/" + args.name + "/" + rel
            mode = os.stat(src).st_mode & 0o7777
            if src.endswith(("chrome-sandbox",)):
                mode |= stat.S_ISUID if False else 0
            files[dest] = (src, mode or 0o644)

    extras = {}
    for spec in args.extra:
        dest, src = spec.split("=", 1)
        src = os.path.abspath(src)
        extras[dest] = (src, os.stat(src).st_mode & 0o7777)
    files.update(extras)

    # 需要补齐的父目录
    dirset = set()
    for f in files:
        parts = f.strip("/").split("/")
        for i in range(1, len(parts)):
            dirset.add("/" + "/".join(parts[:i]))
    dirs_sorted = sorted(dirset)

    # 生成 cpio（目录在前，按路径排序，保证确定性）
    payload = io.BytesIO()
    for d in dirs_sorted:
        payload.write(_cpio_entry(d + "/", b"", 0o040755, buildtime, 0))
    for f in sorted(files):
        src, mode = files[f]
        with open(src, "rb") as fh:
            content = fh.read()
        payload.write(_cpio_entry(f, content, 0o100000 | (mode & 0o755), buildtime))
    payload.write(cpio_trailer(buildtime))
    raw_cpio = payload.getvalue()

    gz = io.BytesIO()
    with gzip.GzipFile(fileobj=gz, mode="wb", compresslevel=9, mtime=buildtime) as g:
        g.write(raw_cpio)
    payload_gz = gz.getvalue()

    # 文件列表相关
    basenames, dirnames = [], []
    dir_index_map = {}
    for f in sorted(files):
        d = os.path.dirname(f) or "/"
        if d not in dir_index_map:
            dir_index_map[d] = len(dirnames)
            dirnames.append(d + "/")
        basenames.append(os.path.basename(f))
    file_list = sorted(files)
    dir_indexes = [dir_index_map[os.path.dirname(f) or "/"] for f in file_list]

    sizes = [os.path.getsize(files[f][0]) for f in file_list]
    modes = [(0o100000 | (files[f][1] & 0o755)) for f in file_list]
    mtimes = [buildtime] * len(file_list)
    digests, linktos, flags, users, groups, inodes, langs, verifyflags = [], [], [], [], [], [], [], []
    for i, f in enumerate(file_list):
        with open(files[f][0], "rb") as fh:
            digests.append(sha256_hex(fh.read()))
        linktos.append("")
        flags.append(0)
        users.append("root")
        groups.append("root")
        inodes.append(i + 1)
        langs.append("")
        verifyflags.append(0xFFFFFFFF)

    main_entries = [
        # RPM 规范：header 必须包含 HEADERI18NTABLE(100)，用于 I18N 字段的 locale 表。
        # 它是 STRING_ARRAY（type=8，1 字节对齐），内容为 locale 名（通常 "C"）。
        hdr_entry_string_array(RPMTAG_HEADERI18NTABLE, ["C"]),
        hdr_entry_string(RPMTAG_NAME, args.name),
        hdr_entry_string(RPMTAG_VERSION, args.version),
        hdr_entry_string(RPMTAG_RELEASE, args.release),
        hdr_entry_i18nstring(RPMTAG_SUMMARY, args.summary),
        hdr_entry_i18nstring(RPMTAG_DESCRIPTION, args.description),
        hdr_entry_int32(RPMTAG_BUILDTIME, buildtime),
        hdr_entry_string(RPMTAG_BUILDHOST, "localhost"),
        hdr_entry_int32(RPMTAG_SIZE, sum(sizes) & 0xFFFFFFFF),
        hdr_entry_string(RPMTAG_VENDOR, "dxy1151"),
        hdr_entry_string(RPMTAG_LICENSE, args.license),
        hdr_entry_string(RPMTAG_PACKAGER, "dxy1151 <dxy1151@users.noreply.github.com>"),
        hdr_entry_i18nstring(RPMTAG_GROUP, "Applications/Multimedia"),
        hdr_entry_string(RPMTAG_URL, args.url),
        hdr_entry_string(RPMTAG_OS, "linux"),
        hdr_entry_string(RPMTAG_ARCH, args.arch),
        hdr_entry_string(RPMTAG_SOURCERPM, f"{args.name}-{args.version}-{args.release}.src.rpm"),
        hdr_entry_string(RPMTAG_RPMVERSION, "4.16.0"),
        hdr_entry_string(RPMTAG_COOKIE, hashlib.md5(f"{args.name}{buildtime}".encode()).hexdigest()),
        hdr_entry_string(RPMTAG_OPTFLAGS, ""),
        hdr_entry_string(RPMTAG_PAYLOADFORMAT, "cpio"),
        hdr_entry_string(RPMTAG_PAYLOADCOMPRESSOR, "gzip"),
        hdr_entry_string(RPMTAG_PAYLOADFLAGS, "9"),
        hdr_entry_string(RPMTAG_PLATFORM, f"{args.arch}-linux"),
        # 依赖（只声明最小必需项；版本留空表示"任意版本"）
        hdr_entry_string_array(RPMTAG_REQUIRENAME, ["/bin/sh"]),
        hdr_entry_int32(RPMTAG_REQUIREFLAGS, [0]),
        hdr_entry_string_array(RPMTAG_REQUIREVERSION, [""]),
        # 提供
        hdr_entry_string_array(RPMTAG_PROVIDENAME, [args.name]),
        hdr_entry_int32(RPMTAG_PROVIDEFLAGS, [0x08 | 0x1000]),
        hdr_entry_string_array(RPMTAG_PROVIDEVERSION, [f"{args.version}-{args.release}"]),
        # 文件
        hdr_entry_int32(RPMTAG_FILESIZES, sizes),
        hdr_entry_int32(RPMTAG_FILEMODES, modes),
        hdr_entry_int32(RPMTAG_FILERDEVS, [0] * len(file_list)),
        hdr_entry_int32(RPMTAG_FILEMTIMES, mtimes),
        hdr_entry_string_array(RPMTAG_FILEDIGESTS, digests),
        hdr_entry_string_array(RPMTAG_FILELINKTOS, linktos),
        hdr_entry_int32(RPMTAG_FILEFLAGS, flags),
        hdr_entry_string_array(RPMTAG_FILEUSERNAME, users),
        hdr_entry_string_array(RPMTAG_FILEGROUPNAME, groups),
        hdr_entry_int32(RPMTAG_FILEVERIFYFLAGS, verifyflags),
        hdr_entry_int32(RPMTAG_FILEINODES, inodes),
        hdr_entry_string_array(RPMTAG_FILELANGS, langs),
        hdr_entry_int32(RPMTAG_DIRINDEXES, dir_indexes),
        hdr_entry_string_array(RPMTAG_BASENAMES, basenames),
        hdr_entry_string_array(RPMTAG_DIRNAMES, dirnames),
        hdr_entry_int32(RPMTAG_ARCHIVESIZE, len(raw_cpio)),
        hdr_entry_int32(RPMTAG_CHANGELOGTIME, [buildtime]),
        hdr_entry_string_array(RPMTAG_CHANGELOGNAME, ["dxy1151 <dxy1151@users.noreply.github.com>"]),
        hdr_entry_string_array(RPMTAG_CHANGELOGTEXT, [f"- {args.version}-{args.release}: Initial RPM build"]),
    ]
    if args.postin:
        main_entries.append(hdr_entry_string(RPMTAG_POSTIN, args.postin))

    main_header = build_header(main_entries)
    # main header 之后、payload 之前按 8 字节对齐（RPM 要求 payload 起始 8 字节对齐）
    main_area = main_header + b"\0" * ((8 - (len(main_header) % 8)) % 8)

    # Signature 摘要（实测校验得出）：
    #   RPMSIGTAG_SHA1 / RPMSIGTAG_SHA256 覆盖的是 **main header 本身**
    #   （从 main header 魔数起，到 hsize 声明的 data store 末尾），
    #   不包含 payload。payload 的完整性由 RPMSIGTAG_LONGSIZE/PAYLOADDIGEST 另行校验。
    body = main_header
    sha1_sig = hashlib.sha1(body).hexdigest()
    sha256_sig = sha256_hex(body)

    payload_digest = sha256_hex(payload_gz)
    sig_entries = [
        HeaderEntry(SIG_SHA1, STRING, sha1_sig.encode() + b"\0", 1),
        HeaderEntry(SIG_SHA256, STRING, sha256_sig.encode() + b"\0", 1),
        hdr_entry_int32(SIG_SIZE, len(main_area) + len(payload_gz)),
        HeaderEntry(SIG_MD5, BIN, hashlib.md5(main_area + payload_gz).digest(), 16),
    ]
    sig_header = build_header(sig_entries)

    # Lead：96 字节
    name_b = args.name.encode()[:65]
    lead = bytearray()
    lead += RPM_LEAD_MAGIC
    lead += bytes([3, 0])                      # major, minor（RPM v3 lead，RPM4+ 兼容）
    lead += struct.pack(">H", 0)               # type = binary
    lead += struct.pack(">H", 0)               # archnum
    lead += name_b + b"\0" * (66 - len(name_b))
    lead += struct.pack(">H", 1)               # osnum = linux
    lead += struct.pack(">H", 5)               # signature type = header
    lead += b"\0" * 16
    assert len(lead) == 96, len(lead)

    # signature header 起点接在 96 字节 lead 之后（96 可被 8 整除）
    sig_padded = sig_header + b"\0" * ((8 - (len(sig_header) % 8)) % 8)
    main_padded = main_area

    out = bytes(lead) + sig_padded + main_padded + payload_gz
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "wb") as fh:
        fh.write(out)

    print(f"RPM 生成成功: {args.out}")
    print(f"  包名      : {args.name}-{args.version}-{args.release}.{args.arch}")
    print(f"  文件数    : {len(files)}")
    print(f"  安装体积  : {sum(sizes)/1024/1024:.1f} MiB")
    print(f"  包大小    : {len(out)/1024/1024:.1f} MiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
