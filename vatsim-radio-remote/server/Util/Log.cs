using System;

namespace VatsimRadioRemote.Util
{
    public static class Log
    {
        private static readonly object Gate = new object();

        public static void Info(string source, string message) { Write(ConsoleColor.Gray, source, message); }
        public static void Good(string source, string message) { Write(ConsoleColor.Green, source, message); }
        public static void Warn(string source, string message) { Write(ConsoleColor.Yellow, source, message); }
        public static void Error(string source, string message) { Write(ConsoleColor.Red, source, message); }

        private static void Write(ConsoleColor color, string source, string message)
        {
            lock (Gate)
            {
                var prev = Console.ForegroundColor;
                Console.ForegroundColor = ConsoleColor.DarkGray;
                Console.Write(DateTime.Now.ToString("HH:mm:ss") + " ");
                Console.ForegroundColor = ConsoleColor.DarkCyan;
                Console.Write(("[" + source + "]").PadRight(12));
                Console.ForegroundColor = color;
                Console.WriteLine(message);
                Console.ForegroundColor = prev;
            }
        }

        public static void Banner(string text)
        {
            lock (Gate)
            {
                var prev = Console.ForegroundColor;
                Console.ForegroundColor = ConsoleColor.White;
                Console.WriteLine();
                Console.WriteLine(text);
                Console.ForegroundColor = prev;
            }
        }
    }
}
