#!/usr/bin/env bash
# 在项目源码里找原生 HTML 控件（用户规则：前后台都不许用原生 select/日期/复选框等，换自定义组件）。
# 用法：bash grep_native_controls.sh <项目目录>
# 退出码：0 = 没找到；1 = 找到（逐行列出）。
set -u
dir="${1:-.}"
pattern='<select[ >]|<option[ >]|<datalist|type=["'"'"'{](date|time|datetime-local|month|week|checkbox|radio|color|range|file)["'"'"'}]|<input[^>]*type=\{?["'"'"'](date|time|checkbox|radio)'
hits=$(grep -rnE "$pattern" "$dir" \
  --include='*.tsx' --include='*.jsx' --include='*.ts' --include='*.html' --include='*.vue' --include='*.svelte' \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.open-next --exclude-dir=dist --exclude-dir=.git \
  --exclude-dir=.wrangler --exclude-dir=coverage 2>/dev/null)
if [ -n "$hits" ]; then
  echo "$hits"
  echo "---"
  echo "found $(printf '%s\n' "$hits" | wc -l | tr -d ' ') native control(s)"
  exit 1
fi
echo "0 native controls"
