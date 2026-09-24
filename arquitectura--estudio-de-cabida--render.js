// Public drawing/export helpers; no study calculation rules.
let validStudy=false;const svgCache={},dxfCache={};
        function shapesToCanvas(cx, shapes, W, H) {
            cx.clearRect(0,0,W,H);
            cx.fillStyle = '#fff'; cx.fillRect(0,0,W,H);
            shapes.forEach(s => {
                if (s.type === 'text') {
                    cx.setLineDash([]);
                    cx.fillStyle = s.stroke || '#000';
                    cx.font = (s.fontPx||12)+'px Arial';
                    cx.fillText(s.text, s.ptsPx[0].x, s.ptsPx[0].y);
                    return;
                }
                cx.beginPath();
                s.ptsPx.forEach((p,i) => i===0 ? cx.moveTo(p.x,p.y) : cx.lineTo(p.x,p.y));
                if (s.closed) cx.closePath();
                cx.setLineDash(s.dash || []);
                if (s.fill) { cx.fillStyle = s.fill; cx.fill(); }
                if (s.stroke) { cx.strokeStyle = s.stroke; cx.lineWidth = s.lineWidth||1; cx.stroke(); }
                cx.setLineDash([]);
            });
        }
        function escapeXML(s) {
            return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }
        function shapesToSVG(shapes, W, H) {
            let body = '';
            shapes.forEach(s => {
                if (s.type === 'text') {
                    const p = s.ptsPx[0];
                    body += `<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" font-size="${s.fontPx||12}" fill="${s.stroke||'#000'}" font-family="Arial, sans-serif">${escapeXML(s.text)}</text>\n`;
                    return;
                }
                const pts = s.ptsPx.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
                const tag = s.closed ? 'polygon' : 'polyline';
                const fillAttr = s.fill ? `fill="${s.fill}"` : 'fill="none"';
                const strokeAttr = s.stroke ? `stroke="${s.stroke}"` : 'stroke="none"';
                const dashAttr = s.dash ? `stroke-dasharray="${s.dash.join(',')}"` : '';
                body += `<${tag} points="${pts}" ${fillAttr} ${strokeAttr} stroke-width="${s.lineWidth||1}" ${dashAttr}/>\n`;
            });
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n<rect width="${W}" height="${H}" fill="#ffffff"/>\n${body}</svg>`;
        }
        function dxfHeader() { return "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n"; }
        function dxfFooter() { return "0\nENDSEC\n0\nEOF\n"; }
        function dxfLine(x1,y1,z1,x2,y2,z2,layer) {
            return `0\nLINE\n8\n${layer||'0'}\n10\n${x1.toFixed(4)}\n20\n${y1.toFixed(4)}\n30\n${(z1||0).toFixed(4)}\n11\n${x2.toFixed(4)}\n21\n${y2.toFixed(4)}\n31\n${(z2||0).toFixed(4)}\n`;
        }
        function dxfText(x,y,z,text,h,layer) {
            return `0\nTEXT\n8\n${layer||'TEXT'}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n${(z||0).toFixed(4)}\n40\n${(h||0.3).toFixed(3)}\n1\n${text}\n`;
        }
        function shapesToDXF(shapes) {
            let body = '';
            shapes.forEach(s => {
                if (s.layer && (s.layer.indexOf('LEYENDA') === 0 || s.layer==='COTAS_BG' || s.layer==='SOMBRA_CARA')) return;
                if (s.type === 'text') {
                    const p = s.ptsWorld[0];
                    body += dxfText(p.x, p.y, p.z||0, s.worldText||s.text, s.worldFontSize||0.3, s.layer);
                    return;
                }
                const pts = s.ptsWorld;
                const n = s.closed ? pts.length : pts.length-1;
                for (let i=0; i<n; i++) {
                    const a = pts[i], b = pts[(i+1)%pts.length];
                    body += dxfLine(a.x,a.y,a.z||0, b.x,b.y,b.z||0, s.layer);
                }
            });
            return dxfHeader()+body+dxfFooter();
        }
        function downloadDataURL(dataUrl, filename) {
            const a = document.createElement('a');
            a.href = dataUrl; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
        }
        function downloadText(text, filename, mime) {
            const blob = new Blob([text], { type: mime||'text/plain' });
            const url = URL.createObjectURL(blob);
            downloadDataURL(url, filename);
            setTimeout(() => URL.revokeObjectURL(url), 1500);
        }
        function exportPNG(canvasId, filename) {
            if (!validStudy) return;
            const c = document.getElementById(canvasId);
            downloadDataURL(c.toDataURL('image/png'), filename);
        }
        function exportJPG(canvasId, filename) {
            if (!validStudy) return;
            const c = document.getElementById(canvasId);
            downloadDataURL(c.toDataURL('image/jpeg', 0.95), filename);
        }
        function exportSVGView(viewKey, filename) {
            if (!validStudy) return;
            const svgStr = svgCache[viewKey];
            if (!svgStr) return;
            downloadText(svgStr, filename, 'image/svg+xml');
        }
        function exportDXFView(viewKey, filename) {
            if (!validStudy) return;
            const dxfStr = dxfCache[viewKey];
            if (!dxfStr) return;
            downloadText(dxfStr, filename, 'application/dxf');
        }
