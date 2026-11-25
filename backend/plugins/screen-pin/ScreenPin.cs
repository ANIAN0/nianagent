using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public sealed class MoonScreenPin : NativeWindow
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr window, int message, IntPtr w, IntPtr l);
    [DllImport("user32.dll")]
    internal static extern bool SetForegroundWindow(IntPtr window);

    private const int HotkeyMessage = 0x0312, ShutdownMessage = 0x8001;
    private Selection selection;
    private readonly List<Pin> pins = new List<Pin>();

    public static void Run()
    {
        SetThreadDpiAwarenessContext(new IntPtr(-4)); // Per-monitor V2, physical desktop pixels.
        var listener = new MoonScreenPin();
        listener.CreateHandle(new CreateParams { Parent = new IntPtr(-3) });
        var handle = listener.Handle;
        try
        {
            if (!RegisterHotKey(handle, 1, 0x4000, (uint)Keys.F1))
            {
                Console.WriteLine(Marshal.GetLastWin32Error() == 1409 ? "HOTKEY_BUSY" : "HOTKEY_FAILED");
                return;
            }
            // Pipe EOF also covers an unexpected loss of the Moon host.
            var watcher = new Thread(() => {
                var input = Console.OpenStandardInput();
                while (input.ReadByte() != -1) { }
                PostMessage(handle, ShutdownMessage, IntPtr.Zero, IntPtr.Zero);
            });
            watcher.IsBackground = true;
            watcher.Start();
            Console.WriteLine("READY");
            Application.Run();
        }
        finally
        {
            listener.CloseAll();
            UnregisterHotKey(handle, 1);
            listener.DestroyHandle();
        }
    }

    private void CloseAll()
    {
        var currentSelection = selection;
        selection = null;
        if (currentSelection != null)
        {
            currentSelection.Close();
            currentSelection.Dispose();
        }
        foreach (var pin in pins.ToArray())
        {
            pin.Close();
            pin.Dispose();
        }
        pins.Clear();
    }

    private void TrackPin(Pin pin)
    {
        pins.Add(pin);
        pin.FormClosed += delegate { pins.Remove(pin); };
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == ShutdownMessage)
        {
            CloseAll();
            Application.ExitThread();
        }
        if (message.Msg == HotkeyMessage && selection == null)
        {
            try
            {
                selection = new Selection(SystemInformation.VirtualScreen, TrackPin);
                selection.FormClosed += delegate { selection = null; };
                selection.Show();
                SetForegroundWindow(selection.Handle);
            }
            catch (Exception error)
            {
                if (selection != null) selection.Dispose();
                selection = null;
                Console.Error.WriteLine("MoonScreenPin capture failed: " + error.Message);
            }
        }
        base.WndProc(ref message);
    }

    private abstract class DesktopForm : Form
    {
        protected DesktopForm(Rectangle bounds)
        {
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            DoubleBuffered = true;
            Bounds = bounds;
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) Close();
            base.OnKeyDown(e);
        }
    }

    private sealed class Selection : DesktopForm
    {
        private readonly Bitmap desktop;
        private readonly Action<Pin> onPinCreated;
        private Point anchor;
        private Rectangle region;
        private bool selecting;

        public Selection(Rectangle bounds, Action<Pin> onPinCreated) : base(bounds)
        {
            this.onPinCreated = onPinCreated;
            Text = "Moon · 框选截图";
            Cursor = Cursors.Cross;
            desktop = new Bitmap(bounds.Width, bounds.Height);
            try
            {
                using (var g = Graphics.FromImage(desktop))
                    g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
            }
            catch { desktop.Dispose(); throw; }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.DrawImageUnscaled(desktop, Point.Empty);
            using (var shade = new SolidBrush(Color.FromArgb(95, Color.Black)))
                g.FillRectangle(shade, ClientRectangle);
            if (region.Width > 0 && region.Height > 0)
            {
                g.DrawImage(desktop, region, region, GraphicsUnit.Pixel);
                g.DrawRectangle(Pens.DeepSkyBlue, region.X, region.Y, region.Width - 1, region.Height - 1);
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Right) { Close(); return; }
            if (e.Button != MouseButtons.Left) return;
            selecting = Capture = true;
            anchor = e.Location;
        }

        private Rectangle Selected(Point end)
        {
            return Rectangle.Intersect(ClientRectangle, Rectangle.FromLTRB(
                Math.Min(anchor.X, end.X), Math.Min(anchor.Y, end.Y),
                Math.Max(anchor.X, end.X), Math.Max(anchor.Y, end.Y)));
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (!selecting) return;
            region = Selected(e.Location);
            Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (!selecting || e.Button != MouseButtons.Left) return;
            selecting = Capture = false;
            region = Selected(e.Location);
            if (region.Width > 0 && region.Height > 0)
            {
                var pin = new Pin(new Rectangle(PointToScreen(region.Location), region.Size),
                    desktop.Clone(region, desktop.PixelFormat));
                onPinCreated(pin);
                pin.Show();
            }
            Close();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && desktop != null) desktop.Dispose();
            base.Dispose(disposing);
        }
    }

    private sealed class Pin : DesktopForm
    {
        private readonly Bitmap image;
        private Point grip;

        public Pin(Rectangle bounds, Bitmap bitmap) : base(bounds)
        {
            image = bitmap;
            Text = "Moon · 桌面贴图";
            Cursor = Cursors.SizeAll;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.DrawImageUnscaled(image, Point.Empty);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            grip = e.Location;
            Capture = true;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (Capture && e.Button == MouseButtons.Left)
                Location = new Point(Cursor.Position.X - grip.X, Cursor.Position.Y - grip.Y);
        }

        protected override void OnMouseUp(MouseEventArgs e) { Capture = false; }
        protected override void OnMouseDoubleClick(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left) Close();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && image != null) image.Dispose();
            base.Dispose(disposing);
        }
    }
}
